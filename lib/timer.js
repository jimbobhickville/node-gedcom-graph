var moment = require('moment');

var Timer = function () {
    this.start = moment();
};

Timer.prototype.snap = function () {
    var end = moment();
    return end.diff(this.start);
};

Timer.prototype.log = function () {
    var elapsed = this.snap();
    console.log('Time elapsed: ' + moment.duration(elapsed, 'ms').humanize());
};

module.exports = Timer;
