# ez-command


## Motivation
When troubleshooting differents environments at the same time I found myself having multiple terminal tabs (with each tab splitted up to 4 terminal) for SSH tunneling, TCP redirections and diagnostic commands among others. Each environment could have been running in a different deployment (say k8s or plain instances) and felt like the cognitive load to switch, add or toggle any of these "groups" of terminals was way too much. I have a really bad memory and wanted something that could help me remember the little tiny details while at the same time being interactive for the user.

## Install
You can use npx (`npx ez-command -c config.json`) or install it globally `npm i ez-command -g`

## Usage
Throughout configuration you will be able to define the name, the command to be executed and a URL property (optional).
The URL column is not detected automatically, it's meant to be an easy shortcut (CTRL+click) to open a URLs from the list.
The configuration can follow two different formats: groups of commands or a plain list.
### Using groups
If you want to define separate certain commands from others groups will be useful. An example of a configuration file using groups would look like as follows:
```json
{
  "groups": [
    {
      "name": "first group",
      "items": [
        {
          "name": "item1 - group 1",
          "command": "ls"
        }
      ]
    }, {
      "name": "second group",
      "items": [
        {
          "name": "item1 - group 2",
          "command": "ps aux"
        }
      ]
    }
  ]
}
```

### Using a plain list
If you're not interested in separating different groups of commands you can provide a configuration similar to the following:
```json
[
  {
    "name": "first item",
    "command": "ls"
  }, {
    "name": "second item",
    "command": "printenv"
  }
]
```

### Examples
You can browse the [examples](./examples) directory to see some configurations.

## Customization
The theme by default is `green` but you can tweak and provide your own customized theme by running:
```
$ ez-command --theme path/to/your/theme -c config.json
```

`ez-command` is also built to support multiple layouts like the logs container displayed on the right, or the bottom. To use such layouts you can specify `ez-command --layout "number"` where number can be one of the described layouts below:

| Layout number | description |
|:-:|:-:|
| 1 | item list to the left and logs to the right |
| 2 | item list to the right and logs to the left |
| 3 | item list to the top left and logs on the bottom half |

## Author
Alejandro Oviedo <[alejandro.oviedo.g@gmail.com](mailto:alejandrooviedog@gmail.com)>