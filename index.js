var creds = require("./.creds");

var graph = require("seraph")(creds);

var moment = require("moment");

var fs = require('fs'),
    Gedcom = require('gedcom-stream'),
    gedcom = new Gedcom();

var tag_names = require('./const/tags');
var temple_codes = require('./const/temples');

/* TODO:

- figure out if neo4j has any special date types that we could leverage
- find existing record before inserting, update if exists (benchmark vs complete re-import)
- extrapolate relationships automatically
- figure out if neo4j has a bulk import tool that might make this faster, rest API is sloooooowwww for bulk
- better way to provide credentials.  surely something is on npm for this already
- better code organization, more custom tag parsers
    - NAME should split into given and surname probably
- figure out neo4j indexes to speed up lookups
- better CLI args, allow piping in gedcom like `node index.js < file.ged`
- export as a library somehow?
*/

var transformations = {
    'TEMP': function (value) {
        return temple_codes[value] || value;
    }
};

var unused_tags = {};

function record_to_node(record) {
    var node = {};
    if (record['id']) {
        /*
        would be nice to figure out how to convert the gedcom id to a graph
        id in a consistent repeatable manner so we can do updates rather than
        blowing away the entire db every import
        maybe 0 offset = I
              1b offset = F
              2b offset = ?? (what other record types?)
        how high can id go? Does node let you specify it on new records?
        */
        node['Gedcom Id'] = record['id'];
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
            if (child['value']) {
                if (child['value'].indexOf('@') == 0) {
                    // TODO: save the relationship!
                }
                if (transformations[child['name']]) {
                    node[key] = transformations[child['name']](child['value'])
                }
                else {
                    node[key] = child['value'];
                }
            }
            if (child['children'] && child['children'].length > 0) {
                var child_obj = record_to_node(child);
                for (child_key in child_obj) {
                    var composite_key = [key, child_key].join(' ');
                    node[composite_key] = child_obj[child_key];
                }
            }
        }
    }
    return node;
}

function save_to_graph(node_data, label) {
    var callback;
    callback = function (err, node) {
        if (err) {
            console.log("Save failed (retrying): " + err)
            save_to_graph(node_data, label, callback)
        }
    }
    graph.save(node_data, label, callback);
}

function gedcom_to_graph(record) {
    var label = tag_names[record['name']];
    if (! label) {
        console.log("Skipping " + record['name'] + ": " + record['id']);
        return;
    }
    var node_data = record_to_node(record);
    save_to_graph(node_data, label);
}

var start = moment();
gedcom.on('data', gedcom_to_graph);
gedcom.on('error', console.log);
gedcom.on('end', function () {
    var end = moment();
    var elapsed = end.diff(start);
    console.log("Unused tags:");
    console.log(unused_tags);

    console.log("Time elapsed: " + moment.duration(elapsed, 'ms').humanize());
})

if (process.argv.length >= 3) {
    fs.createReadStream(process.argv[2]).pipe(gedcom);
}
else {
    throw "You must provide a path to a gedcom file as the sole argument";
}
