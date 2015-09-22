var stream = require('stream');

function LogStreamer (logger) {
    this._logger = logger;
    this._buffer = '';
}

LogStreamer.prototype = new stream.Writable();

LogStreamer.prototype.write = function(data) {
    this._buffer += data;
};

LogStreamer.prototype.end = function() {
    if (this._buffer.length > 0) {
        var lines = this._buffer.split(/[\r\n]+/);
        // remove any leading or trailing empty lines
        while (lines[0] === '') {
            lines.shift();
        }
        if (lines[lines.length - 1] === '') {
            lines.pop();
        }
        for (var i=0; i<lines.length; i++) {
            this._logger(lines[i]);
        }
        this._buffer = '';
    }
};

module.exports = LogStreamer;
