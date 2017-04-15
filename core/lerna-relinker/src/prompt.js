#!/usr/bin/env node
import LsCommand from 'lerna/lib/commands/LsCommand'
import set from 'lodash/set';
import get from 'lodash/get';
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

function parse(value) {
    value = value.trim();
    if (value === 'true' || value === 'false') {
        return JSON.parse(value);
    }
    if (value === 'null') return null;
    if (value === '') return value;
    if ((value.startsWith('{') && value.endsWith('}')) ||
        (value.startsWith('[') && value.endsWith(']')) ||
        (value.startsWith('"') && value.endsWith('"')) ||
        /^((?:NaN|-?(?:(?:\d+|\d*\.\d+)(?:[E|e][+|-]?\d+)?|Infinity)))$/.test(value))
        return JSON.parse(value);
    return JSON.parse(`"${value}"`)
}
function empty(json, key) {
    return get(json, key) !== void(0);
}

async function _set(json, [key, value], filename, opts) {
    if (get(json, key) === value) {
        return false;
    }
    if (empty(json, key) || (opts.confirm ? await confirm(`are you sure you want to change ${key}`) : true))
        set(json, key, value);
    return true;
}

function __get(key) {
    return JSON.stringify(get(this, key));
}
async function _move(json, keys, filename, opts) {
    const [from, to] = keys;
    if (!from || !to) {
        console.warn(`move requires an argument`, from, to);
    }
    const f = get(json, from);
    if (f !== void(0)) {
        if (opts.confirm && !(await confirm(`Are you sure you want to move '${from}' to '${to}'`))) {
            return false;
        }
        set(json, from, void(0));
        //Merge objects if there is a destination
        if (typeof f === 'object' && get(json, to)) {
            for (const key of Object.keys(f)) {
                set(json, `${to}.${key}`, f[key]);
            }
        } else {
            set(json, to, f);
        }
    }
}

function _get(json, keys, filename, opts) {
    const str = _keys.map(__get, json).join(',');
    console.log(this.name, '=', str);
    return false;
}
async function confirm(message, value) {
    const answer = await inquirer.prompt([{message, type: 'confirm', name: 'confirm', default: value}]);
    return answer.confirm;
}
async function _delete(json, keys, filename, opts) {
    for (const key of keys) {
        const value = get(json, key);
        if (value === void(0) || (opts.confirm && !(await confirm(`Are you sure you want to delete '${key}'`)))) {
            return false;
        }
        if (get(json, keys[0]) === void(0)) {
            return false;
        }
        set(json, keys[0], void(0));
    }
    return true;
}
async function muckFile(pkg, file, opts) {
    let saveMuck = false;
    const fullname = path.join(pkg._location, file);
    let json;
    try {
        json = await
            read(fullname);
    } catch (e) {
        console.warn(`Error reading ${fullname}`, e);
        return false
    }
    for (const cmd of opts.commands) {
        saveMuck |= await
            cmd[0].call(pkg, json, cmd[1], file, opts);
    }

    if (saveMuck && json) {
        let newfile = fullname + opts.extension;
        if (!opts.noExtension && fs.existsSync(newfile)) {
            if (!(await confirm(`a file named ${newfile} already, do want to overwrite?`))) {
                return;
            }
        }
        try {
            await
                write(newfile, json);
        } catch (e) {
            console.warn(`Error writing ${newfile}`, e)
        }
    }
    return true;

}
async function _prompt(json, args, filename, options) {
    const
        [key, vmessage = 'Do you want to change the property'] = args,
        self = this,
        _default = get(json, key),
        message = `${vmessage} '${key}' in '${this.name}/${filename}'?`;

    if (options.skipIfExists && _default != null) {
        return;
    }
    const change = await confirm(message);

    if (change) {
        const answer = await inquirer.prompt([{
            type: 'input',
            name: 'value',
            message: `OK what would like to change it to?`
        }]);
        if (answer.value === _default) {
            return false;
        }
        try {
            set(json, key, parse(answer.value));
            return true;
        } catch (e) {
            console.log(`Could not parse the value try again`, e);
            return _prompt.call(self, json, args, filename, options);
        }
        return false;
    }
}

async function muck(name, args) {


    function help(msg) {
        if (msg) console.error(msg);
        console.log(`${name}   [-sdgihfe] <files>
      -b\t--backup\tuse a different extension
      -p\t--prompt\tkey=question\tprompt for value before changing 
      -c\t--confirm\tconfirm before dangerous operations
      -m\t--move\t\tMove property from=to
      -s\t--set\t\tkey=value sets key to value
      -d\t--delete\tdeletes values (comma)
      -g\t--get\t\tvalue gets the value
      -i\t--ignore\tpackages to ignore
      -h\t--help\t\tthis helpful message
      -f\t--file\t\tpackage.json default
      -k\t--skip-if-exists\tSkip the question if it has value
      -n\t--no-lerna\tJust use the file don't iterate over lerna projects
      --no-extension\tuse in place
    `);
        return 1;
    }

    const opts = {
        extension: '.bck',
        files: [],
        commands: [],
        options: {}
    };
    const commands = opts.commands;
    const options = opts.options;
    //need this to suck up files at the end.
    let i = 0;
    for (let l = args.length; i < l; i++) {
        let [arg, val] = args[i].split('=', 2);
        switch (arg) {
            //actions
            case '-s':
            case '--set':
                const [key, value] = (val || args[++i]).split('=', 2);
                commands.push([_set, [key, parse(value)]]);
                break;
            case '-d':
            case '--delete':
                commands.push([_delete, (val || args[++i]).split(/,\s*/)]);
                break;
            case '-g':
            case '--get':
                commands.push([_get, (val || args[++i]).split(/,\s*/)]);
                break;
            case '-m':
            case '--move':
                commands.push([_move, (val || args[++i]).split(/\s*=\s*/, 2)]);
                break;
            case '--prompt':
            case '-p':
                commands.push([_prompt, (val || args[++i]).split('=', 2)]);
                break;
            //options
            case '-k':
            case '--skip-if-exists':
                opts.skipIfExists = true;
                break;
            case '--confirm':
            case '-c':
                opts.confirm = true;
                break;
            case '-i':
            case '--ignore':
                options['ignore'] = args[++i];
                break;
            case '-f':
            case '--file':
                opts.files = opts.files.concat((val || args[++i]).split(/,\s*/));
                break;

            case '-e':
            case '--extension':
            case '-b':
            case '--backup':
                opts['extension'] = (val || args[++i]).trim();
                if (!opts['extension']) {
                    return help(`--backup requires an extension use --no-backup to rename in place`)
                }
                break;
            case '--no-extension':
            case '--no-backup':
                opts.noExtension = true;
                break;

            case '-n':
            case '--no-lerna':
                opts.noLerna = true;
                break;
            case '-h':
            case '--help':
                return help();

        }
    }
    if (commands.length == 0) {
        return help(`need a command ${args}`);
    }

    opts.files = opts.files.concat(args.slice(i));
    if (opts.files.length == 0) {
        opts.files.push('package.json');
    }
    if (!opts.noLerna) {
        const ls = new LsCommand(null, options, process.cwd());
        ls.runPreparations();
        for (const pkg of ls.filteredPackages) {
            for (const file of opts.files) {
                await muckFile(pkg, file, opts);
            }
        }
    } else {
        for (const file of opts.files) {
            await  muckFile({name: '.', _location: process.cwd()}, file, opts);
        }
    }
}

function write(filename, json) {
    return new Promise(function (resolve, reject) {
        fs.writeFile(filename, JSON.stringify(json, null, 2), 'utf8', function (e, o) {
            if (e) return reject(e);
            resolve(o);
        });
    })
}
function read(filename) {
    return new Promise(function (resolve, reject) {
        fs.readFile(filename, 'utf8', function (e, o) {
            if (e) return reject(e);
            try {
                resolve(JSON.parse(o));
            } catch (e) {
                reject(e);
            }
        })
    })
}

if (require.main === module) {
    muck(process.argv[1], process.argv.slice(2)).then(function (res) {
        process.exit(res);
    }, function (e) {
        console.trace(e);
        process.exit(1);
    });
}