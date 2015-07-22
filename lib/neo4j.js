var child_process = require('child_process');
var events = require('events');
var path = require('path');

var fs = require('fs-extra');

function Neo4JManager (bindir, db_path) {
    this.neo4jbin = path.join(bindir, 'neo4j');
    this.importbin = path.join(bindir, 'neo4j-import');
    this.db_paths = {
        'backup': path.normalize(db_path + '.bak'),
        'temp': path.normalize(db_path + '.tmp'),
        'real': path.normalize(db_path),
    };
    this.child_process_stdio = ['ignore', process.stdout, process.stderr];
};

Neo4JManager.prototype = new events.EventEmitter();

Neo4JManager.prototype._setupTempDir = function () {
    try {
        fs.removeSync(this.db_paths['temp']);
    } catch (e) {
        if (e['code'] !== 'EEXIST') {
            throw e;
        }
    }
    fs.mkdirpSync(this.db_paths['temp']);
};

Neo4JManager.prototype._swapDirs = function () {
    try {
        fs.removeSync(this.db_paths['backup']);
    } catch (e) {
        if (e['code'] !== 'EEXIST') {
            throw e;
        }
    }
    this.emit('swapping', this.db_paths['real'], this.db_paths['backup']);
    fs.renameSync(this.db_paths['real'], this.db_paths['backup']);

    this.emit('swapping', this.db_paths['temp'], this.db_paths['real']);
    fs.renameSync(this.db_paths['temp'], this.db_paths['real']);
};

Neo4JManager.prototype._restoreDirs = function () {
    fs.removeSync(this.db_paths['real']);

    this.emit('swapping', this.db_paths['backup'], this.db_paths['real']);
    fs.renameSync(this.db_paths['backup'], this.db_paths['real']);
};

Neo4JManager.prototype._manage_process = function (command) {
    this.emit('manage', this.neo4jbin, command);
    this.emit(command + 'Begin');
    var neo_proc = child_process.spawn(this.neo4jbin, [command], {
        'stdio': this.child_process_stdio
    });
    neo_proc.on('close', function (code, signal) {
        this.emit(command + 'Process', code);
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
    import_args.unshift('--into', this.db_paths['temp']);
    this.emit('start', this.importbin, import_args);

    this._setupTempDir();

    this.on('stopProcess', function (code) {
        this._swapDirs();
        this.start();
    }.bind(this));

    this.on('startProcess', function (code) {
        if (code !== 0) {
            this._restoreDirs();
            throw 'Starting neo4j failed.  Abort.';
        }
        this.emit('finish', this.importbin, import_args);
    }.bind(this));

    var import_proc = child_process.spawn(this.importbin, import_args, {
        'stdio': this.child_process_stdio
    });
    import_proc.on('close', function (code) {
        if (code === 0) {
            this.stop();
        }
        else {
            throw 'Import failed. Exited ' + code + '. Abort.';
        }
    }.bind(this));
};

module.exports = Neo4JManager;
