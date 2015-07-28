var moment = require('moment');

var Timer = function () {
    this.start = moment();
};

Timer.prototype.snap = function () {
    var elapsed = moment().diff(this.start);
    return moment.duration(elapsed, 'ms').humanize();
};

module.exports = Timer;
