var fs = require("fs");
var util = require("util");
var http = require("http");
var url = require("url");
var os = require("os");
var qs = require('querystring');
//var m3u8stream = require("m3u8stream");
var SopPlayer = require("./player/sop");
var AcePlayer = require("./player/ace");
var AceProcess = AcePlayer.AceProcess;
var optns = {};
optns.aceInstallPath = "C:\\ACEStream\\ACEStream";
//optns.aceIp = "192.168.1.10";

var port=8088;
switch (os.platform()) {
  case "linux": //linux
    //optns.aceInstallPath = "/opt/acestream/acestream_3.1.16_ubuntu_16.04_x86_64";
    optns.aceInstallPath = "/opt/acestream/acestream_3.1.35_ubuntu_18.04_x86_64";
    break;
}
if (process.argv.length > 2) {
  for (var i = 2; i < process.argv.length; i++) {
    var opt = process.argv[i];
    switch (opt) {
      case "-p":
      case "--port":
        var p = parseInt(process.argv[++i]); //first arg is port
        if (!isNaN(p)) port = p;
        break;
      case "-i":
      case "--install":
        var install = process.argv[++i];
        if (install) {
          var fstats = fs.statSync(install);
          if (fstats.isDirectory()) {
            optns.aceInstallPath = install;
          } else {
            console.error("Invalid directory %s [Not a directory]", install);
            process.exit(-1);
          }
        }
        break;
      case "-h":
      case "-?":
      case "--help":
        console.warn(" [-p,--port <Port>] [-i,--install <Install Path>] [-h,-?,--help]");
        process.exit();
        break;

    }
  }
}

console.log("Port bound to %d", port);

//var video_cnt = 0, video_files = null, video_url = null;
var acePattern = /^(acestream|ts|st):\/\//;
//var aceplayer = null;
var acechannels = null;
//var initializePlayer = function initializePlayer() {
//  var player = new AcePlayer(optns);
//  player.on("error", function (err) {
//    console.log(err);
//    //if (!video_url) exit; //Haven't got url.
//  });
//  player.on("ready", function () {
//    aceplayer = this;
//  });
//  player.on("end", function (reason) {
//    console.log("End");
//    //aceplayer = null;
//    //process.exit();
//  });
//};
class SopChannel {
  constructor() {
    console.log("Initialize Sop Channel");
    this._player = new SopPlayer({"waitTimeMS":0});
    this._player.on("close", () => {
      console.log("Sop Player closed");
      if (this._currentRes) {
        this._stopVideoStream(this._currentRes);
        this._currentRes = null;
      }
    });
  }

  _sendError (res, errMsg) {
    console.error("Sending 500: %s", errMsg);
    res.writeHead(500, errMsg, {
      "Access-Control-Allow-Origin": "*"
    });
    res.end("500: " + errMsg);
    return;
  }

  play(chid, req, res) {
    if (this._player.playing) {
      this._player.shutdown();
      this._sendError(res, "A Sop Channel is already playing");
      return;
    }
    var host = req.headers.host.replace(/:\d+$/,"");
    res.chid = chid;
    res.video = {};
    this._player.play(chid, host, port+1, (err, video_url)=>{
      if (err) {
        this._sendError(res, err.message);
        return;
      }
      console.log(`Sop playback url ${video_url}`);
      this._startVideoStream(res, video_url); return;
      res.writeHead(302, { "Location": video_url}); res.end(); return;
    });
  }
  _startVideoStream (res, video_url) {
    console.log("Streaming video %s", video_url);
    var vurl = url.parse(video_url, false);
    var reqOptn = {
      hostname : vurl.hostname,
      port : vurl.port,
      //path : vurl.pathname + '?' + qs.stringify(vurl.query),
      path : vurl.path,
      method : 'GET',
      headers: AceChannels.RequestHeaders
    };
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*'
    });
    var vreq = res.video.req = http.request(reqOptn, (vres) => {
      res.video.res = vres;
      //var data = "";
      //vres.on("data", function(chunk) {
      //  data += chunk;
      //  if (data.length > 1024*16) {
      //    res.write(data);
      //    data = "";
      //  }
      //});
      vres.removeAllListeners("data");
      var buffered = 0;//true;
      if (buffered) {
        var sbuf = new StreamBuffer({id: 0});
        vres.pipe(sbuf, {end: true}).pipe(res, {end: true}); //set end: false to keep destination stream open
      } else {
        vres.pipe(res, {end: true}); //set end: false to keep destination stream open
      }
      res.socket.setKeepAlive(true /*,initialDelay*/);
      // 60 second timeout. Change this as you see fit.
      res.socket.setTimeout(30 * 1000, function() {
        console.log("socket timed out.");
        this.end();
        this.destroy();
      });
      this._currentRes = res;
      res.on("close", () => {
        res.removeAllListeners("close");
        console.log("client closed request");
        if (this._currentRes === res) {
          res.video.res = null;
          this._player.shutdown();
          this._currentRes = null;
        }
      });
      vres.on("end", () => {
        console.log("video streaming ended");
        //if (res.video.res) res.video.res.unpipe(res); //destination stream would have already closed
        res.video.res = null;
        this._player.shutdown();
        this._currentRes = null;
      });
    });
    vreq.on('error', (e) => {
      console.error('ERROR: Problem with request: ', e);
      this._sendError(res, e.message);
    });
    vreq.end();
  }
  _stopVideoStream (res, onclose) {
    var stopStreaming = () => {
      console.log("stop streaming");
      if (typeof onclose === "function") onclose.call(res);
      if (res.video.url) { //Abort streaming request
        console.log("abort streaming");
        if (res.video.req) res.video.req.abort();
        res.video = {};
      }
    };
    if (res.video.res) {
      var vres = res.video.res;
      vres.unpipe(res);
      vres.removeAllListeners("data");
      vres.on("data", function(data) {
        console.log("handle on data");
        this.removeAllListeners("data");
        stopStreaming();
      });
    }
    setImmediate(stopStreaming);
  }
  shutdown() {
    this._player.shutdown();
  }
}

var aceprocess = new AceProcess(optns, function(err) {
  if (err) {
    console.error('error starting ace player: %o', err);
    this.emit("error",err);
    return;
  }
  optns.skipLaunch = true;
//  initializePlayer();
  acechannels = new AceChannels();
});
var sopchannel = new SopChannel();
var proxy = createProxyService();
var cleanup = function() {
  if (proxy) proxy.close();
  if (sopchannel) sopchannel.shutdown();
//  if (aceplayer) {
//    aceplayer.shutdown();
//    aceplayer = null;
//  }
  if (acechannels) {
    acechannels.shutdown();
    acechannels = null;
  }
  if (aceprocess) {
    aceprocess.kill();
    aceprocess = null;
  }
};

process.on('SIGINT', function() {
  console.log('SIGINT');
  cleanup();
  process.exit();
});

process.on('exit', function(code) {
  console.log("EXIT START: Exiting with code: %s.", code);
  cleanup();
  console.log("EXIT END: Exited with code: %s.", code);
});

function createProxyService() {
  var srv = http.createServer(function (req, res) {
    console.log("A new request was made by a client.");
    var reqUrl = url.parse(req.url, true);
    var chid = reqUrl.query.chid;
    if (!chid){
      res.writeHead(500, "Missing Channel Id (chid)", {
        'Access-Control-Allow-Origin': '*'
      });
      res.end();
      return;
    }
    if (chid.startsWith("sop://")) {
      sopchannel.play(chid, req, res);
      return;
    }
    if (!acechannels) {
      res.writeHead(500, "Not ready", {
        'Access-Control-Allow-Origin': '*'
      });
      res.end();
      return;
    }
    acechannels.play(chid, req, res);
    return;
 //   if (!aceplayer) {
 //     res.writeHead(500, "Not ready", {
 //       'Access-Control-Allow-Origin': '*'
 //     });
 //     res.end();
 //     return;
 //   }
 //   aceplayer.stop();
 //   var aceReq  = null, aceRes = null;
 //   if (!chid) {
 //     res.writeHead(500, "Missing channel Id", {
 //       'Access-Control-Allow-Origin': '*'
 //     });
 //     res.end();
 //     return;
 //   }
 //   res.writeHead(200, {
 //     'Access-Control-Allow-Origin': '*'
 //   });
 //   chid = chid.replace(acePattern, "");
 //   var isTorrent = /\.torrent/.test(chid);
 //   var isHttp = /^http[s]*:\/\//.test(chid);
 //   var module = (!isHttp && !isTorrent) ? "PID" : "TORRENT";
 //   aceplayer.removeAllListeners("torrent-loaded");
 //   aceplayer.removeAllListeners("video-ready");
 //   var waitSecs = (video_url) ? 3000: 100;
 //   video_url = null;
 //   aceplayer.once("torrent-loaded", function (cnt, files) {
 //     video_files = files;
 //     video_cnt = cnt;
 //     aceplayer.initVideo(0);
 //   });
 //   aceplayer.once("video-ready", function (vurl, fname) {
 //     console.log(vurl);
 //     video_url = vurl;
 //     vurl = url.parse(video_url, false);
 //     //vurl.query || (vurl.query ={});
 //     var reqOptn = {
 //       hostname : vurl.hostname,
 //       port : vurl.port,
 //       //path : vurl.pathname + '?' + qs.stringify(vurl.query),
 //       path : vurl.path,
 //       method : 'GET',
 //       headers: {
 //         "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/35.0.1916.153 Safari/537.36",
 //         "Cache-Control": "max-age=0",
 //         "DNT": 1,
 //         "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
 //         "Accept-Language": "en-US,en;q=0.8",
 //         "Connection": "keep-alive",
 //         "Content-Type":"video/x-ms-asf"
 //       }
 //     };
 //     aceReq = http.request(reqOptn, function (ares) {
 //       aceRes = ares;
 //       //var data = "";
 //       //aceRes.on("data", function(chunk) {
 //       //  data += chunk;
 //       //  if (data.length > 1024*16) {
 //       //    res.write(data);
 //       //    data = "";
 //       //  }
 //       //});
 //       aceRes.removeAllListeners("data");
 //       var buffered = 0;//true;
 //       if (buffered) {
 //         var sbuf = new StreamBuffer({id: 0});
 //         aceRes.pipe(sbuf, {end: true}).pipe(res, {end: true}); //set end: false to keep destination stream open
 //       } else {
 //         aceRes.pipe(res, {end: true}); //set end: false to keep destination stream open
 //       }
 //       res.socket.setKeepAlive(true /*,initialDelay*/);
 //       // 60 second timeout. Change this as you see fit.
 //       res.socket.setTimeout(60 * 1000, function() {
 //         console.log("socket timed out.");
 //         this.end();
 //         this.destroy();
 //       });
 //       aceRes.on("end", function() {
 //         console.log("ace video closed");
 //         //if (aceRes) aceRes.unpipe(res); //destination stream would have already closed
 //         aceRes = null;
 //       });
 //     });
 //     aceReq.on('error', function(e) {
 //       console.error('ERROR: Problem with request: ', e);
 //     });
 //     aceReq.end();
 //   });
 //   setTimeout(function() {
 //     aceplayer.loadTorrent(module, chid);
 //   }, waitSecs);
 //   res.on("close", function() {
 //     console.log("request close event");
 //     if (aceRes) {
 //       var closePlayer = () => {
 //         if (video_url) { //Stop if previously running
 //           console.log("stop player");
 //           aceplayer.stop();
 //           aceReq.abort();
 //         }
 //         video_url = null;
 //       };
 //       aceRes.unpipe(res);
 //       aceRes.removeAllListeners("data");
 //       aceRes.on("data", function(data) {
 //         console.log("on data");
 //         closePlayer();
 //         this.removeAllListeners("data");
 //         aceRes = null;
 //       });
 //       closePlayer();
 //     } else {
 //       if (aceplayer) aceplayer.stop();
 //     }
 //     aceRes = null;
 //   });
  }).listen(port);
  return srv;
}

function AceChannels() {
  console.log("Initialize Ace Channels");
  this._id = 0;
  this._available = new Set();
  this._active = new Map();
  this._initPlayer();
}
AceChannels.RequestHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/35.0.1916.153 Safari/537.36",
  "Cache-Control": "max-age=0",
  "DNT": 1,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.8",
  "Connection": "keep-alive",
  "Content-Type":"video/x-ms-asf"
};
AceChannels.ACE_PATTERN = /^(acestream|ts|st):\/\//;
AceChannels.SendError = function sendError(res, errMsg) {
  console.error("Sending 500: %s", errMsg);
  res.writeHead(500, errMsg, {
    "Access-Control-Allow-Origin": "*"
  });
  res.end("500: " + errMsg);
  return;
};
AceChannels.StartVideoStream = function StartVideoStream(res, video_url) {
  console.log("Streaming video %s", video_url);
  var vurl = url.parse(video_url, false);
  //vurl.query || (vurl.query ={});
  var reqOptn = {
    hostname : vurl.hostname,
    port : vurl.port,
    //path : vurl.pathname + '?' + qs.stringify(vurl.query),
    path : vurl.path,
    method : 'GET',
    headers: AceChannels.RequestHeaders
  };
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*'
  });
  var vreq = res.video.req = http.request(reqOptn, function (vres) {
    res.video.res = vres;
    //var data = "";
    //vres.on("data", function(chunk) {
    //  data += chunk;
    //  if (data.length > 1024*16) {
    //    res.write(data);
    //    data = "";
    //  }
    //});
    vres.removeAllListeners("data");
    var buffered = 0;//true;
    if (buffered) {
      var sbuf = new StreamBuffer({id: 0});
      vres.pipe(sbuf, {end: true}).pipe(res, {end: true}); //set end: false to keep destination stream open
    } else {
      vres.pipe(res, {end: true}); //set end: false to keep destination stream open
    }
    res.socket.setKeepAlive(true /*,initialDelay*/);
    // 60 second timeout. Change this as you see fit.
    res.socket.setTimeout(30 * 1000, function() {
      console.log("socket timed out.");
      this.end();
      this.destroy();
    });
    vres.on("end", function() {
      console.log("video streaming ended");
      //if (res.video.res) res.video.res.unpipe(res); //destination stream would have already closed
      res.video.res = null;
    });
  });
  vreq.on('error', function(e) {
    console.error('ERROR: Problem with request: ', e);
  });
  vreq.end();
};
AceChannels.StopVideoStream = function StopVideoStream(res, onclose) {
  var stopStreaming = () => {
    console.log("stop streaming");
    if (typeof onclose === "function") onclose.call(res);
    if (res.video.url) { //Abort streaming request
      console.log("abort streaming");
      if (res.video.req) res.video.req.abort();
      res.video = {};
    }
  };
  if (res.video.res) {
    var vres = res.video.res;
    vres.unpipe(res);
    vres.removeAllListeners("data");
    vres.on("data", function(data) {
      console.log("handle on data");
      this.removeAllListeners("data");
      stopStreaming();
    });
  }
  setImmediate(stopStreaming);
};
AceChannels.prototype._initPlayer = function initPlayer() {
  console.log("Initialize Ace Channel Player");
  var self = this;
  var player = new AcePlayer(optns);
  player._externalId = ++this._id;
  player.on("error", function (err) {
    var player = this;
    console.error(err);
    console.error("Got Error on player %d, %j", player._externalId, err);
    var player = this;
    //We wouldn't close connections
    //self._delistPlayer(player);
  });
  player.on("ready", function () {
    var player = this;
    console.log("Player ready %d", player._externalId);
    self._available.add(player);
  });
  player.on("end", function (reason) {
    var player = this;
    console.log("Player closed %d", player._externalId);
    self._delistPlayer(player);
    //process.exit();
  });
};
AceChannels.prototype._delistPlayer = function derefPlayer(player) {
  if (!this._available.delete(player)) {
    var res = this._active.get(player);
    if (res) res.end();
    this.stop(player);
  }
};
AceChannels.prototype.shutdown = function shutdown() {
  console.log("Shutdown Ace Channels");
  this._available.forEach((p) => {
    p.shutdown();
    p.removeAllListeners();
  });
  this._available.clear();
  this._active.forEach((r, p) => {
    p.shutdown();
    p.removeAllListeners();
    r.end();
  });
  this._active.clear();
};
AceChannels.prototype.stop = function stop(player) {
  console.log("Stop Ace Channel");
  if (!player) return;
  console.log("Stop Ace Player %d", player._externalId);
  this._active.delete(player);
  player.removeAllListeners("torrent-loaded");
  player.removeAllListeners("video-ready");
  player.stop();
  console.log("Active players count %d", this._active.size);
};
AceChannels.prototype.stopActivePlayers = function stopActivePlayers() {
  const players = [];
  console.log("StopActivePlayers: Players before count Available:%d, Active:%d", this._available.size, this._active.size);
  this._active.forEach((res, player) => {
    if (res) AceChannels.StopVideoStream(res, () => { });
    this.stop(player);
    players.push(player);
  });
  setTimeout(() => {
    //make players available
    for (const player of players)
      this._available.add(player);
    console.log("StopActivePlayers: Players new count Available:%d, Active:%d", this._available.size, this._active.size);
  }, 1000); //Make player available after 3 secs
};
AceChannels.prototype.play = function play(chid, req, res) {
  console.log("Play channel id - %s", chid);
  var self = this;
  if (!chid) {
    AceChannels.SendError(res, "Missing channel Id");
    return;
  }
  chid = chid.replace(AceChannels.ACE_PATTERN, "");
  var isTorrent = /\.torrent/.test(chid);
  var isHttp = /^http[s]*:\/\//.test(chid);
  var module = "TORRENT";
  if (!isHttp && !isTorrent) {
    if (chid.startsWith('magnet:')) {
      var magres = /magnet:(\?xt\=urn:btih:)*([\w]+)\&*/.exec(chid);
      if (magres) {
        chid = magres[magres.length-1];
        console.log(`INFOHASH: ${chid}`);
        module = "INFOHASH";
      } else {
        AceChannels.SendError(res, "Invalid magnet link");
        return;
      }
    } else {
      module = "PID";
    }
  }
  var reqUrl = url.parse(req.url, true);
  if (reqUrl.query.single) {
    this.stopActivePlayers();
  }
  res.chid = chid;
  res.direct = reqUrl.query.direct || reqUrl.query.d;
  res.video = {};
  if (this._available.size === 0) {
    if (this._active.size) this._initPlayer(); //TODO: should we do this?
    AceChannels.SendError(res, "Player no ready");
    return;
  }

  var player = p;
  console.log("ONPLAY: Players count Available:%d, Active:%d", this._available.size, this._active.size);
  this._available.forEach((p) => {
    player = p;
    console.log("player id %d", p._externalId);
    return false;
  });
  this.stop(player); //Also does cleanup internally for safety
  this._available.delete(player);
  this._active.set(player, res);
  console.log("ONPLAY: Players new count Available:%d, Active:%d", this._available.size, this._active.size);

  //var waitSecs = (video_url) ? 3000: 100;
  var waitSecs = 100;
  player.once("torrent-loaded", function (cnt, files) {
    var player = this;
    var res = self._active.get(player);
    if (!res) return;
    res.video.files = files;
    res.video.file_count = cnt;
    player.initVideo(0);
  });
  player.once("video-ready", function (vurl, fname) {
    console.log(vurl);
    var player = this;
    var res = self._active.get(player);
    if (!res) return;
    res.video.url = vurl;
    if (!res.direct) {
      if (!vurl.endsWith(".m3u8") && ! /127.0.0.1:6878/.test(vurl)) {
        AceChannels.StartVideoStream(res, vurl); return;
      } else {
          /*
        const m3u8strm = m3u8stream(vurl);
        m3u8strm.on('error', (e) => {
          console.error('ERROR: Problem with mwu8stream: ', e);
        });
        m3u8strm.pipe(res);
        return;
        */
      }
    }
/*
 * nginx config: sudo add-apt-repository ppa:nginx/stable && sudo apt-get update && sudo apt-get install nginx-extras
  location /content/ {
    proxy_pass http://127.0.0.1:6878;
    proxy_redirect off;
    proxy_pass_header Set-Cookie;
    proxy_pass_header P3P;
    log_subrequest on;
  }
  location /hls/ {
    proxy_pass http://127.0.0.1:6878;
    proxy_redirect off;
    proxy_pass_header Set-Cookie;
    proxy_pass_header P3P;
    log_subrequest on;
  }
*/
    var host = req.headers.host;
    console.log(host);
    if (host.startsWith('127.0.0.1')) {
      res.writeHead(302, { "Location": vurl }); res.end(); return;
    } else {
      res.writeHead(302, { "Location": vurl.replace("127.0.0.1:6878", host.replace(/:\d+$/,"")) }); res.end(); return;
    }
  });
  res.on("close", function() {
    console.log("Response close event");
    var res = this;
    AceChannels.StopVideoStream(res, function onclose() {
      console.log("ONCLOSE");
      var res = this;
      var player = null;
      self._active.forEach((r, p) => {
        if (r === res) {
          player = p;
          return false;
        }
      });
      console.log("ONCLOSE: Players count Available:%d, Active:%d", self._available.size, self._active.size);
      if (player) {
        self.stop(player);
        setTimeout(function() {
          //make player available
          self._available.add(player);
          console.log("ONCLOSE: Players new count Available:%d, Active:%d", self._available.size, self._active.size);
        }, 1000); //Make player available after 3 secs
      }
    });
  });

  setTimeout(function() {
    player.loadTorrent(module, chid);
  }, waitSecs);
  //create another player
  if (!this._available.size) this._initPlayer();
}

var Transform = require('stream').Transform;
function StreamBuffer(options) {
  options || (options = {});
  Transform.call(this, options);
  this._id = options.id || 0;
  this._bufsize = options.size || (1024*16);
  this._buffer = null;
  this._lprefix = "StreamBuffer["+this._id+"]: ";
}

util.inherits(StreamBuffer, Transform);

StreamBuffer.prototype._transform = function(chunk, encoding, callback) {
  //this.push(chunk); console.log(this._lprefix, "GOT ", chunk.length); callback(); return;
  console.log(this._lprefix, "GOT", chunk.length);
  this._buffer = (this._buffer) ? Buffer.concat([this._buffer, chunk]) : chunk;
  if (this._buffer.length >= this._bufsize)
    this._chunkedPush();
  else
    console.log(this._lprefix, "CACHED ", this._buffer.length);
//  if (!this._buffer) {
//    if (chunk.length >= this._bufsize) {
//      this._chunkedPush(chunk);
////      var pushed = 0;
////      var datalen = chunk.length;
////      while (datalen > (pushed+this._bufsize)) {
////        var packet = chunk.slice(pushed, this._bufsize);
////        this.push(packet);
////        console.log(this._lprefix, "PUSHED CHUNK ", packet.length);
////        if (pushed + this._bufsize > datalen) break;
////        pushed += this._bufsize;
////      }
////      if (datalen > pushed + this._bufsize) {
////        this._buffer = chunk.slice(pushed+this._bufsize);
////        console.log(this._lprefix, "Remaining CHUNK - ", this._buffer.length);
////      }
//    } else {
//      this._buffer = chunk;
//      console.log(this._lprefix, "GOT", chunk.length, "Cached chunk ", this._buffer.length);
//    }
//  } else {
//    if (this._buffer.length + chunk.length >= this._bufsize) {
//      this._chunkedPush(chunk);
////      //this.push(this._buffer);
////      //this.push(chunk);
////      var pushed = 0;
////      var datalen = this._buffer.length + chunk.length);
////      while (chunk.length > (pushed+this._bufsize)) {
////      var packet = Buffer.concat([this._buffer, chunk.slice(0, (this._bufsize-this._buffer.length))]);
////      this.push(packet);
//      console.log(this._lprefix, "GOT", chunk.length, "PUSHED ", packet.length);
//      if (this._buffer.length + chunk.length >= this._bufsize) this._buffer = null;
//      else {
//        this._buffer = chunk.slice(this._bufsize-this._buffer.length);
//        console.log("Remaining CHUNK2 - ", this._buffer.length);
//      }
//    } else {
//      this._buffer = Buffer.concat([this._buffer, chunk])
//      console.log(this._lprefix, "GOT", chunk.length, "Cached ", this._buffer.length);
//    }
//  }
  callback();
};

StreamBuffer.prototype._chunkedPush = function() {
  var datalen = this._buffer.length;
  console.log(this._lprefix, "AVAILABLE ", datalen);
  while (datalen >= this._bufsize) {
    var pos = this._buffer.length-datalen;
    var packet = this._buffer.slice(pos, pos+this._bufsize);
    console.log(this._lprefix, "PUSHED ", packet.length);
    this.push(packet);
    datalen -= packet.length;
    console.log(this._lprefix, "PENDING ", datalen, " of ", this._buffer.length);
  }
  if (datalen > 0) {
    this._buffer = this._buffer.slice(this._buffer.length-datalen);
    console.log(this._lprefix, "CACHED ", this._buffer.length);
  } else {
    this._buffer = null;
  }
};

StreamBuffer.prototype._flush = function(callback) {
  if (this._buffer) this.push(this._buffer);
  console.log(this._lprefix + "Flush ",  this._buffer ? this._buffer.length : 0);
  this._buffer = null;
  callback();
};
