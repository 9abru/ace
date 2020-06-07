"use strict";
const EventEmitter = require('events');
const os = require('os');
const cp = require('child_process');
const path = require('path');

const debug = function() {
  console.log.apply(null, arguments);
};

class SopPlayer extends EventEmitter {
  constructor(options) {
    super();
    options||(options = {});
    this._installPath = options.installPath||"/usr/local/bin/";
    this._waitTimeMS = options.waitTimeMS||8000;
  }

  get playing () {
    return Boolean(this._process);
  }

  play (channelUrl, listenIp, listenPort, cb) {
    if (this._nextrequest) {
      cb(new Error("Pending request!!!"));
      return;
    }
    if (this._process) {
      this._nextrequest = Array.prototype.slice.call(arguments);
      this._kill();
    } else {
      process.nextTick(() => {
        this._launch.apply(this, arguments);
      });
    }
  }

  _raiseClose () {
    if (this._process) {
      this._process = null;
      this.emit("close");
      if (this._nextrequest) {
        setTimeout(() =>{
          this.play.apply(this, this._nextrequest);
          this._nextrequest = null;
        });
      }
    }
  }

  //os.platform() : 'linux'
  //os.platform() : 'darwin'
  //os.platform() : 'win32'
  //os.platform() : 'sunos'
  _launch (channelUrl, listenIp, listenPort, cb) {
    if (!channelUrl || !channelUrl.startsWith("sop://")) {
      cb(new Error("Channel Url should start with sop://"));
      return;
    }
    if (typeof listenIp === "function") {
      cb = listenIp;
      listenIp = null;
      listenPort = null;
    }
    if (typeof listenIp === "number") {
      cb = listenPort;
      listenPort = listenIp;
      listenIp = null;
    }
    if (typeof listenPort === "function") {
      cb = listenPort;
      listenPort = null;
    }
    listenIp || (listenIp = "127.0.0.1");
    listenPort || (listenPort = 8902);
    const playbackUrl = `http://${listenIp}:${listenPort}/tv.asf`;
    switch (os.platform()) {
      case "linux": //linux
        const sopBin = path.join(this._installPath, 'sp-sc');
        //sp-sc ${channelUrl} 3908 ${listenPort}
        //sp-sc sop://broker.sopcast.com:3912/259497 3902 8902
        const cmd = [channelUrl, "3902", listenPort];
        this._process = cp.spawn(sopBin, cmd);
        break;
      case "win32":
      case "darwin": //osx
      default:
        cb(new Error(`Platform ${os.platform()} not supported`));
        return;
    }
    let spawnErr = null;
    this._process.stdout.on('data', (data) => {
      debug('stdout: ' + data);
    });
    this._process.stderr.on('data', (data) => {
      debug('stdout: ' + data);
    });
    this._process.on('error', (err) => {
      spawnErr = err;
      debug('Error starting process : ' + err);
      this.emit("error", err);
    });
    this._process.on('close', (code, signal) => {
      debug('Closing code: ' + code);
      this._raiseClose();
    });
    this._process.on('exit', (code, signal) => {
      debug('Exit code: ' + code);
      this._raiseClose();
    });
    setTimeout(() => {
      cb(spawnErr, playbackUrl);
    }, this._waitTimeMS);
  }

  //os.platform() : 'linux'
  //os.platform() : 'darwin'
  //os.platform() : 'win32'
  //os.platform() : 'sunos'
  _kill () {
    debug("Killing processes");
    if (this._process) {
      try {
        this._process.kill(); //TRY sending SIGTERM
        //this._process.kill('SIGKILL'); //TRY sending SIGKILL
        debug("SIGTERM SENT!!!")
        setTimeout(() => {
          if (this._process) this._process.kill('SIGKILL'); //TRY sending SIGKILL
          debug("SIGKILL SENT!!!");
        }, 1000);
      } catch (ex) {
        console.error("Error sending kill command", ex)
      }
    } else {
      //If process was already running the spawn would have just closed
      //debug("Nothing to kill!!!");
      //return;
    }
    switch (os.platform()) {
      case "linux": //linux
        break;
      case "win32":
      case "darwin": //osx
      default:
        debug(util.format("Platform %s not supported", os.platform()));
        break;
    }
  }

  shutdown() {
    this._kill();
  }
}

module.exports = SopPlayer;

// const sopplayer = new SopPlayer({"waitTimeMS": 0});
// sopplayer.play("sop://178.239.62.116:3912/256720", "127.0.0.1", 9089, (err, playbackUrl)=>{
//   console.log(playbackUrl);
//   setTimeout(function() {
//     if (sopplayer) sopplayer.shutdown();
//   }, 5000);
// });
// sopplayer.on("error", function(err) { console.error(err);});
// sopplayer.on("close", function() { console.log("SHUTDOWN!!!");});