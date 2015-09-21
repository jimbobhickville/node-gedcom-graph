var fs = require('fs-extra');
var path = require('path');
var stream = require('stream');

var csv = require('fast-csv');


var tag_names = require('../const/tags');
var temple_codes = require('../const/temples');

function CsvWriter (scratch_dir) {
    this._unused_tags = {};
    this._missing_temple_codes = {};
    this._scratch_dir = scratch_dir;
    this._output_streams = {'relationships': {}, 'nodes': {}};
    try {
        fs.mkdirpSync(this._scratch_dir);
    } catch (e) {
        if (e['code'] !== 'EEXIST') {
            throw e;
        }
    }
};

CsvWriter.prototype = new stream.Writable();

CsvWriter.prototype.cleanup = function () {
    fs.remove(this._scratch_dir);
}

var boolean_tag = function(node, key, value) {
    node[key] = value ? 'True' : 'False';
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
    'PLAC': function (node, key, value) {
        // A Place *can* be a Temple, but not necessarily
        if (temple_codes[value]) {
            node[key] = [temple_codes[value], 'Temple'].join(' ');
        }
        else {
            node[key] = value;
        }
    },
    'TEMP': function (node, key, value) {
        if (temple_codes[value]) {
            node[key] = temple_codes[value];
        }
        else {
            this._missing_temple_codes[value] = true;
            node[key] = value;
        }
    },
    'NAME': function (node, key, value) {
        // Format is: "First Middle /Last/"
        //   * All fields are optional
        if (value.indexOf('/') != -1) {
            var name_pieces = value.split('/');
            if (name_pieces[0].match(/[^\s]/)) {
                node['Given Name'] = name_pieces[0];
            }
            if (name_pieces[1].match(/[^\s]/)) {
                node['Surname'] = name_pieces[1];
            }
        }
        else {
            node['Given Name'] = value;
        }
        node[key] = value;
    },
};

CsvWriter.prototype._write_to_csv = function(type, tag, data) {
    var filename = path.join(this._scratch_dir, type + '-' + tag + '.csv');
    this.emit('write', filename, type, tag, data);
    if (! this._output_streams[type][filename]) {
        this.emit('generate', type, filename);
        var out = fs.createWriteStream(filename, {encoding: 'utf8'});
        out.on('finish', function () {
            delete this._output_streams[type][filename];
            if (Object.keys(this._output_streams[type]).length === 0) {
                delete this._output_streams[type];
            }
            if (Object.keys(this._output_streams).length === 0) {
                var missing_temples = Object.keys(this._missing_temple_codes);
                if (missing_temples.length > 0) {
                    this.emit('missing', 'Temple Codes', missing_temples);
                }
                var unused_tags = Object.keys(this._unused_tags);
                if (unused_tags.length > 0) {
                    this.emit('missing', 'Tags', unused_tags);
                }
                this.emit('finish');
            }
        }.bind(this));
        this._output_streams[type][filename] = csv.createWriteStream({'headers': true});
        this._output_streams[type][filename].pipe(out);
    }
    this._output_streams[type][filename].write(data);
    this.emit('write', filename, type, tag, data);
}

CsvWriter.prototype._save_relationship = function(tag, rel_data) {
    this._write_to_csv('relationships', tag, rel_data);
};

CsvWriter.prototype._save_node = function(tag, node_data) {
    this._write_to_csv('nodes', tag, node_data);
};

CsvWriter.prototype._record_to_node = function(record, node_id) {
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
                this._unused_tags[child['name']] = true;
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
                        this._save_relationship(child['name'], rel_data);
                    }
                }
                else {
                    if (transformations[child['name']]) {
                        transformations[child['name']].bind(this)(node, key, child['value'])
                    }
                    else {
                        node[key] = child['value'];
                    }
                }
            }
            if (child['children'] && child['children'].length > 0) {
                var child_obj = this._record_to_node.bind(this)(child, node_id);
                if (key == 'Event') {
                    // EVENT is not unique, use its TYPE as the real key name
                    key = child_obj['Type'];
                    delete child_obj['Type'];
                }
                for (child_key in child_obj) {
                    var composite_key = [key, child_key].join(' ');
                    node[composite_key] = child_obj[child_key];
                }
            }
        }
    }
    return node;
};

CsvWriter.prototype.write = function(record) {
    this.emit('read', record);
    var label = tag_names[record['name']];
    if (! label) {
        this.emit('skip', record);
        return;
    }
    var node_data = this._record_to_node(record, record['id']);
    if (Object.keys(node_data).length > 0) {
        node_data[':LABEL'] = label;
        this._save_node(record['name'], node_data);
    }
};

CsvWriter.prototype.end = function() {
    for (type in this._output_streams) {
        for (filename in this._output_streams[type]) {
            this._output_streams[type][filename].end();
        }
    }
};

module.exports = CsvWriter;
