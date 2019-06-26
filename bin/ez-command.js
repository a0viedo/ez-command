#!/usr/bin/env node

const path = require('path');
const program = require('commander');
const { load } = require('../lib');

program
  .option('-c, --config <file>', 'configuration file')
  .option('-l, --layout <number|file>', 'layout for displaying')
  .option('-t, --theme <file>', 'JSON file to be used as theme');

program.parse(process.argv);

function startsWithSlash(str){
  return str[0] === '/';
}

(async ()=> {
  try {
    let configFile;
    let layoutFile;
    if(startsWithSlash(program.config)) {
      configFile = require(path.resolve(program.config));
    } else {
      configFile = require(path.resolve(process.cwd(), program.config));
    }
  
    let themeFile;
    if(program.theme) {
      if(startsWithSlash(program.theme)) {
        themeFile = require(path.resolve(program.theme));
      } else {
        themeFile = require(path.resolve(process.cwd(), program.theme));
      }
      
    } else {
      themeFile = require(path.resolve(__dirname, '../themes/green.json'));
    }
  
    if(program.layout) {
      if(program.layout.includes('.json')) {
        layoutFile = require(path.resolve(process.cwd(), program.layout));
      } else {
        layoutFile = require(path.resolve(__dirname, '../layouts', `${program.layout}.json`));
      }
    } else {
      layoutFile = require(path.resolve(__dirname, '../layouts/2.json'));
    }
    await load(configFile, themeFile, layoutFile);
  } catch(err) {
    console.log(`Error in configuration input: ${err.message}`);
    process.exit(1);
  }
})();

