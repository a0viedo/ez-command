'use strict';

const { spawn, execSync } = require('child_process');
const os = require('os');
const { format } = require('date-fns');
const blessed = require('blessed');
const contrib = require('blessed-contrib');
const allSettled = require('promise-all-settled');

const LOG_MAX_LIMIT = 200;
const ITEM_ACTIVITY_TRANSITION_TIME = 2000;
const DATE_FORMAT = 'HH:mm:ss';
const log = process.env.LOGS_ENABLED ? console.log : () => {};

const globalState = {};
const runningProcesses = {};
let activeState;
let screen;
let theme;
let grid;
let layout;
let columnNameMap = {
  name: 0,
  status: 1,
  lastUpdate: 2
};

const tableHeaders = [['{bold}Name{/bold}', '{bold}Status{/bold}', '{bold}Activity{/bold}', '{bold}URL{/bold}']];

function mapScreenKeys() {
  screen.key(['escape', 'q', 'C-c'], async function () {
    // TODO: maybe show a message while all processes are killed, it could take a few seconds
    await killAllProcesses();
    screen.destroy();
    return process.exit(0);
  });

  screen.key(['l'], () => {
    const item = activeState[screen.table.selected - 1];
    log(`viewing logs for item ${item.index}`);
    updateLogs(item);
    activeState.viewedLogs = item;
    screen.render();
  });

  screen.key(['c'], () => {
    log('toggle configuration view');
    const item = activeState[screen.table.selected - 1];
    if(screen.itemConfig) {
      screen.remove(screen.itemConfig);
    }
    
    if(activeState.itemConfigurationEnabled === item) {
      activeState.itemConfigurationEnabled = null;
    } else {
      log('drawing item config');
      drawItemConfiguration(toDisplayFormat(item));
      activeState.itemConfigurationEnabled = item;
    }

    screen.render();
  });

  screen.key(['j'], async () => {
    // start all processes
    await allSettled(activeState.map((item) => {
      if(!item.started) {
        return startItem(item).then(() => {
          updateTable(item.index, { status: 'running', lastUpdate: item.lastUpdate});
        }).catch((err) => {
          log('there was an error starting item', item.index, err);
        });
      }
      return Promise.resolve();
    }));
    screen.render();
  });

  screen.key(['k'], async () => {
    await killAllProcesses();
  });

  screen.key(['tab'], () => {
    if(!globalState.groups || globalState.groups.length <= 1) {
      return;
    }

    log('switching groups');
    const selected = screen.table.selected;
    screen.remove(screen.table);
    clearTransitions(activeState);
    if(globalState.groups.length - 1 === globalState.selectedGroup) {
      globalState.selectedGroup = 0;
    } else {
      globalState.selectedGroup++;
    }

    activeState = globalState.groups[globalState.selectedGroup];
    drawTable(activeState, activeState.name);
    // preserve selected index from previous group
    screen.table.select(selected);

    activeState.viewedLogs = null;
    resetLogContainer({ name: '' });
    screen.render();
  });
}

function updateTable(index, itemObject){
  const itemList = Object.entries(columnNameMap).sort(([k, valueA], [j, valueB]) => valueA > valueB).map(([key]) => { // eslint-disable-line no-unused-vars
    return itemObject[key];
  });

  const newTable = screen.table.rows.slice();
  const selected = screen.table.selected;
  newTable[index + 1] = Object.assign([], newTable[index + 1], toHoleyArray(itemList));
  screen.table.setData(newTable);
  // preserve selected from previous state
  screen.table.select(selected);
  
}

async function killAllProcesses(){
  log('killing all processes');

  for (const group of globalState.groups) {
    for (const item of group) {
      killProcesses(item.processes);
    }
  }
}

async function toggleItem(itemConfig) {
  if (itemConfig.started) {
    return stopItem(itemConfig);
  } else {
    return startItem(itemConfig);
  }
}

async function stopItem(itemConfig) {
  log(`stopping item ${itemConfig.index}`);
  try {
    await allSettled(itemConfig.processes.map(pid => {
      runningProcesses[pid].forcedStop = true;
      return killProcess(pid);
    }));
    itemConfig.processes = [];
    itemConfig.started = false;
    itemConfig.status = 'stopped';
    itemConfig.lastUpdate = format(
      new Date(),
      DATE_FORMAT
    );
  } catch (err) {
    // TODO: check what's the best thing to do here, clear the pid of the item? if you don't, next time you try to kill a non-existent pid it will error
    log('there was an error trying to kill the list of processes', err.message);
  }
}

async function killProcess(pid) {
  try {
    log(`killing process with pid ${pid}`);
    // mute stderr and stdout
    execSync(`pkill -P ${pid}; kill ${pid}`, { stdio: 'ignore' });
    // execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
  } catch(err) {
    log(`there was an error trying to kill process ${pid}`, err.message);
  }
}

function killProcesses(pids) {
  return pids.forEach(pid => killProcess(pid));
}

function toHoleyArray(arr) {
  const newArr = new Array(arr.length);
  arr.forEach((e, i) => {
    if(typeof e !== 'undefined') {
      newArr[i] = e;
    }
  });
  return newArr;
}

async function startItem(itemConfig) {
  log(`running item ${itemConfig.index}`);

  try {
    if (itemConfig.ordered) {
      for (const command of itemConfig.list) {
        const pid = await exec(command);
        itemConfig.processes.push(pid);
      }
    } else {

      function handleProcessEvent(status){
        log('callback for process execution was called, status:', status);
        let message;
        let styledMessage;
        if(status && status.code === 0) {
          message ='completed';
          styledMessage = '{green-bg}{white-fg}completed{/white-fg}{/green-bg}';
        } else {
          message ='stopped'; // or killed
          styledMessage = '{red-bg}{white-fg}stopped{/white-fg}{/red-bg}';
        }

        itemConfig.started = false;
        itemConfig.status = message;
        itemConfig.lastUpdate = `stopped at ${format(new Date(), DATE_FORMAT)}`;

        if(activeState.indexOf(itemConfig) !== -1) {
          updateTable(itemConfig.index, {
            status: styledMessage,
            lastUpdate: itemConfig.lastUpdate
          });
        }

        activeState.transitions.push(setTimeout(() => {
          if(activeState.indexOf(itemConfig) !== -1) {
            updateTable(itemConfig.index, {
              status: message
            });
          }
        }, ITEM_ACTIVITY_TRANSITION_TIME));
        screen.render();
      }
      itemConfig.logs = [];
      const pid = exec(itemConfig.command, itemConfig, handleProcessEvent);
      log('executed process with pid:', pid);
      itemConfig.processes.push(pid);
      itemConfig.started = true;
      itemConfig.status = 'running';
      itemConfig.lastUpdate = `started at ${format(new Date(), DATE_FORMAT)}`;
    }
  } catch (err) {
    log('there was an error', err);
    try {
      // clean executed processes if there were any
      await Promise.all(killProcesses(itemConfig.processes));
    } catch (e) { }
    itemConfig.started = false;
    itemConfig.errored = true;
  }
}

function exec(cmd, item, fn) {
  log(`running command: ${cmd}`);
  return spawnProcess(cmd, item, fn);
}

function spawnProcess(cmd, item, fn) {
  if(!cmd || typeof fn !== 'function') {
    throw new Error('Invalid parameters');
  }

  // why in the hell stdin is required to be inherited for some stdio formatting to take place?
  const p = spawn('sh', ['-c', cmd], { stdio: ['inherit', null, null]});

  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (data) => {

    let formattedData = data;
    if(data[data.length - 1].match(/\n/g)) {
      formattedData = data.substr(0, data.length -1);
    }
    const separatedLines = formattedData.split('\n');
    separatedLines.forEach(line => {
      appendLogs(item, line);
      if(activeState.viewedLogs === item) {
        screen.log.log(line);
      }
    });
  });
  p.on('exit', (code) => {
    log('process is exiting. code:', code);
    if(typeof fn === 'function') {
      log('executing callback function for process with pid ', p.pid);
      fn({
        exitted: true,
        code
      });
    }
  });

  runningProcesses[p.pid] = {
    running: true
  };
  return p.pid;
}

function appendLogs(item, data) {
  if(item.logs.length > LOG_MAX_LIMIT) {
    item.logs.shift();
  }
  item.logs.push(data);
}

function drawFooter() {
  log('drawing footer');
  const commands = {
    enter: 'toggle item',
    tab: 'switch group',
    c: 'view config',
    l: 'view logs',
    j: 'start all',
    k: 'stop all',
    q: 'exit'
  };
  let text = '';
  for (const [cmd, description] of Object.entries(commands)) {
    text += `  {white-bg}{black-fg}${cmd}{/black-fg}{/white-bg} ${description}`;
  }

  const footerLeft = blessed.box({
    width: '100%',
    top: '99%',
    tags: true
  });
  footerLeft.setContent(text);
  screen.append(footerLeft);
}

function sortObjectAlphabetically(a, b) {
  const nameA = a.name.toUpperCase();
  const nameB = b.name.toUpperCase();
  if(nameA < nameB) {
    return -1;
  }

  if(nameA > nameB) {
    return 1;
  }

  return 0;
}

function configurationToInternalState(fileItems) {
  return fileItems.filter(item => {
    return typeof item.name === 'string' && item.command && item.command !== '';
  }).map(item => ({
    name: item.name,
    started: false,
    processes: [],
    command: item.command,
    logs: [],
    url: item.url
  }));
}

function formatItems(items){
  return items.sort(sortObjectAlphabetically).map((item, index) => {
    return Object.assign({}, item, {
      name: item.name.substr(0, 30),
      status: item.status,
      lastUpdate: item.lastUpdate ? item.lastUpdate.substr(0, 20) : '',
      index
    });
  });
}

function drawTable(internalItems, label){
  const table = grid.set(...layout.table, blessed.listtable, {
    parent: screen,
    label: label ? ` ${label} ` : 'Processes',
    top: '0',
    left: '0',
    data: tableHeaders.concat(internalItems.map(item => [item.name, item.status || 'stopped', item.lastUpdate || '', item.url || ''])),
    border: 'line',
    align: 'center',
    tags: true,
    keys: true,
    width: '95%',
    height: '100%',
    style: theme.table,
    mouse: false
  });
  table.focus();
  table.on('select', async (el, tableIndex) => {
    const selected = tableIndex - 1;
    const itemConfig = activeState[selected];
    await toggleItem(itemConfig);
    log(`toggling item with index ${selected}`);

    let status;
    if(!itemConfig.started) {
      status = 'stopped';
    } else {
      resetLogContainer(itemConfig);
      status = 'running';
    }
    updateTable(selected, { status, lastUpdate: itemConfig.lastUpdate});

    updateLogs(itemConfig);
    activeState.viewedLogs = itemConfig;
    screen.render();
  });

  screen.table = table;
  return table;
}

function resetLogContainer(item) {
  screen.remove(screen.log);
  drawLogContainer(item.name);
}

function updateLogs(item){
  if(activeState.viewedLogs !== item) {
    resetLogContainer(item);
    item.logs.forEach(l => screen.log.log(l));
  }
}

function drawLogContainer(label){
  const log = grid.set(...layout.logContainer, contrib.log,
    { fg: 'green',
      selectedFg: 'green',
      label: label ? ` Logs - ${label} ` : ' Logs ',
      bufferLength: 100,
      style: theme.logContainer
    });
  screen.log = log;
}

function drawItemConfiguration(item) {
  const box = grid.set(...layout.itemConfiguration, blessed.box, {
    label: ' Item configuration ',
    content: JSON.stringify(item, null, 2),
    wrap: true,
    style: theme.configurationContainer
  });
  screen.itemConfig = box;
}

function drawHeader(){
  const header = blessed.text({
    top: 'top',
    left: 2,
    width: '50%',
    height: '1',
    style: theme.header,
    content: `{bold}Host:{/bold} ${os.hostname()}`,
    tags: true
  });
  const box = blessed.box({
    wrap: false,
    top: 0,
    left: 0
  });
  screen.append(header);
  screen.header = box;
}

function drawMessage(content){
  var over = grid.set(5, 4, 2, 4, blessed.box, {
    shadow: true,
    align: 'center',
    style: {
      bg: 'blue',
    },
    border: 'line',
    draggable: false,
    tags: true,
    content
  });
  over.focus();
}

function showErrorMessage(message){
  let seconds = 3;
  drawMessage(`{white-fg}{bold} Unexpected error \r\n ${message} \r\n\r\n\r\n Exitting in 3 seconds{/}`);
  screen.render();

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      seconds--;
      drawMessage(`{white-fg}{bold} Unexpected error \r\n ${message} \r\n\r\n\r\n Exitting in ${seconds} seconds{/}`);
      screen.render();
      if(seconds === 0) {
        clearInterval(interval);
        return resolve();
      }
    }, 1000);
  });
}

process.on('uncaughtException', async err => {
  log('there was an unexpected error', err.message);
  await showErrorMessage(err.message);
  await cleanUp();
  process.exit(1);
});

process.on('unhandledRejection', async err => {
  log('there was an unhandled rejection', err.message);
  await cleanUp();
  await showErrorMessage(err.message);
  process.exit(1);
});

process.on('exit', async code => {
  log('exitting', code);
  await cleanUp();
  await showErrorMessage('exitting');
});

async function cleanUp(){
  screen.destroy();
  await killAllProcesses();
}

function clearTransitions(state) {
  log('clearing transitions', state.transitions);
  state.transitions.forEach(t => clearTimeout(t));
}

function isValidConfiguration(config){
  if(config.groups) {
    return config.groups.find(group => group.items.find(item => typeof item.command !== 'string')) === undefined;
  }
  return config.find(item => typeof item.command !== 'string') === undefined;
}

function toDisplayFormat(item) {
  const { logs, ...result } = item; // eslint-disable-line no-unused-vars
  return result;
}

module.exports.load = async function (configFile, themeFile, layoutFile) {
  screen = blessed.screen();
  grid = new contrib.grid({rows: 12, cols: 12, screen});
  theme = {...themeFile};
  layout = layoutFile;

  mapScreenKeys();

  log(`screen.width :${screen.width}`);

  if(!isValidConfiguration(configFile)) {
    await showErrorMessage('invalid configuration format');
    return process.exit(1);
  }

  if(configFile.groups) {
    const startIndex = 0;
    globalState.selectedGroup = startIndex;
    globalState.groups = configFile.groups.map(item => Object.assign(formatItems(configurationToInternalState(item.items)), {
      name: item.name,
      transitions: []
    }));
    
    activeState = globalState.groups[startIndex];
  } else {
    globalState.groups = [Object.assign(formatItems(configurationToInternalState(configFile)), {
      transitions: []
    })];
    activeState = globalState.groups[0];
  }

  drawHeader();
  drawTable(activeState, activeState.name);
  drawLogContainer();
  drawFooter();

  screen.render();
};
