var fs = require('fs');
var Gedcom = require('gedcom-stream');
var moment = require('moment');
var csv = require('fast-csv');
var exec = require('child_process').exec;


/* TODO:
- figure out if neo4j has any special date types that we could leverage
- better code organization, more custom tag parsers
    - NAME should split into given and surname probably
- figure out neo4j indexes to speed up lookups
- export as a library somehow?
- profile for obvious speed issues
- store to temp db, stop neo4j, move folders, keep backup of old one, start neo4j again
- better temp location for csvs
- rather than opts.importer, opts.neo4jbin to point us to all of the binaries
- logging?
- break various pieces out into separate components, looser coupling
*/

var tag_names = require('./const/tags');
var temple_codes = require('./const/temples');

var opts = require('nomnom')
    .option('input', {
        abbr: 'i',
        help: 'Path to the gedcom file you want to parse'
    })
    .option('output', {
        abbr: 'o',
        required: true,
        help: 'Path to the neo4j data folder you wish to replace'
    })
    .option('importer', {
        abbr: 'e',
        default: 'neo4j-import',
        help: 'Path to the neo4j-import tool (if not in $PATH)'
    })
    .parse();

var start = moment();
function record_duration() {
    var end = moment();
    var elapsed = end.diff(start);
    console.log('Time elapsed: ' + moment.duration(elapsed, 'ms').humanize());
}


var import_args = [opts.importer, '--into', opts.output];
function import_to_neo4j() {
    var cmd = import_args.join(' ');
    console.log('Beginning import process: ', cmd);
    exec(cmd, function(error, stdout, stderr) {
        if (error) {
            console.log('Import failed: ', error);
        }
        else {
            var lines = stdout.split(/\n/);
            while (lines.length > 0) {
                line = lines.shift();
                if (line.indexOf('IMPORT DONE') != -1) {
                    lines.unshift(line);
                    break;
                }
            }
            if (lines.length > 0) {
                console.log(lines.join('\n'));
            }
            exec('rm -f out/*.csv', function (error, stdout, stderr) {
                // don't really care
            });
        }
        record_duration();
    });
}

var missing_temple_codes = {};
var boolean_tag = function(value) {
    return value ? 'True' : 'False';
};
var transformations = {
    /*
    TODO:
        _DATE_TYPE is 2 - what does that mean? What other values are valid?
        _PLACE_TYPE as well
    */
    '_DESC_FLAG': boolean_tag,
    '_ITALIC': boolean_tag,
    '_LDS': boolean_tag,
    '_MASTER': boolean_tag,
    '_NONE': boolean_tag,
    '_PAREN': boolean_tag,
    '_PRIM': boolean_tag,
    '_PRIMARY': boolean_tag,
    'TEMP': function (value) {
        if (temple_codes[value]) {
            return temple_codes[value];
        }
        missing_temple_codes[value] = true;
        return value;
    },
};

var csv_writers = {'relationships': {}, 'nodes': {}};
function write_to_csv(type, tag, data) {
    var filename = 'out/' + type + '-' + tag + '.csv';
    if (! csv_writers[type][filename]) {
        import_args.push('--' + type, filename);
        var out = fs.createWriteStream(filename, {encoding: 'utf8'});
        out.on('finish', function () {
            delete csv_writers[type][filename];
            if (Object.keys(csv_writers[type]).length === 0) {
                delete csv_writers[type];
            }
            if (Object.keys(csv_writers).length === 0) {
                record_duration();
                import_to_neo4j();
            }
        });
        csv_writers[type][filename] = csv.createWriteStream({'headers': true});
        csv_writers[type][filename].pipe(out);
    }
    csv_writers[type][filename].write(data);
}

function save_relationship(tag, rel_data) {
    write_to_csv('relationships', tag, rel_data);
}

function save_node(tag, node_data) {
    write_to_csv('nodes', tag, node_data);
}

var unused_tags = {};
function record_to_node(record, node_id) {
    var node = {};
    if (record['id']) {
        node['Gedcom Id:ID'] = record['id'];
    }
    if (record['children']) {
        var l = record['children'].length;
        for (var i=0; i<l; i++) {
            var child = record['children'][i];
            var key = tag_names[child['name']];
            if (! key) {
                unused_tags[child['name']] = true;
                continue;
            }
            if (child['value'] !== '' || child['children'].length == 0) {
                if (child['value'].indexOf('@') == 0) {
                    if (node_id) {
                        var rel_data = {
                            ':START_ID': node_id,
                            ':END_ID': child['value'].replace(/@/g, ''),
                            ':TYPE': key,
                        };
                        save_relationship(child['name'], rel_data);
                    }
                }
                else {
                    if (transformations[child['name']]) {
                        node[key] = transformations[child['name']](child['value'])
                    }
                    else {
                        node[key] = child['value'];
                    }
                }
            }
            if (child['children'] && child['children'].length > 0) {
                var child_obj = record_to_node(child, node_id);
                for (child_key in child_obj) {
                    var composite_key = [key, child_key].join(' ');
                    node[composite_key] = child_obj[child_key];
                }
            }
        }
    }
    return node;
}

function gedcom_to_graph(record) {
    var label = tag_names[record['name']];
    if (! label) {
        console.log('Skipping ' + record['name'] + ': ' + record['id']);
        return;
    }
    var node_data = record_to_node(record, record['id']);
    if (Object.keys(node_data).length > 0) {
        node_data[':LABEL'] = label;
        save_node(record['name'], node_data);
    }
}

var gedcom = new Gedcom();
gedcom.on('data', gedcom_to_graph);
gedcom.on('error', console.log);
gedcom.on('end', function () {
    record_duration();

    for (type in csv_writers) {
        for (filename in csv_writers[type]) {
            csv_writers[type][filename].end();
        }
    }

    unused_tags = Object.keys(unused_tags);
    if (unused_tags.length > 0) {
        console.log('Unused tags: ', unused_tags);
    }

    missing_temple_codes = Object.keys(missing_temple_codes);
    if (missing_temple_codes.length > 0) {
        console.log('Missing temple codes: ', missing_temple_codes);
    }
})

if (opts.input) {
    console.log('Reading from ', opts.input);
    fs.createReadStream(opts.input).pipe(gedcom);
}
else {
    console.log('Reading from STDIN');
    process.stdin.pipe(gedcom);
}