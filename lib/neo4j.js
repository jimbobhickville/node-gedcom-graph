var child_process = require('child_process');
var events = require('events');
var path = require('path');

var moment = require('moment');


var child_process_stdio = ['ignore', process.stdout, process.stderr];

function Neo4JManager (bindir) {
    this.neo4jbin = path.join(bindir, 'neo4j');
    this.importbin = path.join(bindir, 'neo4j-import');
};
Neo4JManager.prototype = new events.EventEmitter();

Neo4JManager.prototype._manage_process = function (command) {
    this.emit('manage', this.neo4jbin, command);
    this.emit(command + 'Begin');
    var neo_proc = child_process.spawn(this.neo4jbin, [command], {
        'stdio': child_process_stdio
    });
    neo_proc.on('close', function (code, signal) {
        this.emit(command + 'End', code);
    }.bind(this));
};

Neo4JManager.prototype.stop = function () {
    this._manage_process('stop');
};

Neo4JManager.prototype.start = function () {
    this._manage_process('start');
};

Neo4JManager.prototype.restart = function () {
    this._manage_process('restart');
};

Neo4JManager.prototype.import = function (import_args) {
    this.emit('importBegin', this.importbin, import_args);
    var import_proc = child_process.spawn(this.importbin, import_args, {
        'stdio': child_process_stdio
    });
    import_proc.on('close', function (code) {
        this.emit('importEnd', this.importbin, import_args, code);
    }.bind(this));
};

module.exports = Neo4JManager;
