"use strict";
const http=require("http");
const https=require("https");
const fs = require('fs');
const mUrl = require('url');
const zlib = require('zlib');
const SERVERIP = "127.0.0.1";
const invoker = {
  /**
   * Helper to invoke parallel action
   * @param actions
   * @param handler
   * @param data
   * @param done
   */
  parallel: function(actions, handler, data, done) {
    if (typeof data === "function") {
      done = data;
      data = {};
    } else if (!data) {
      data = {};
    }
    var candidate = actions.length;
    var completed = 0;
    var callback = function (err) {
      var action = this;
      if (err) {
        callback = function () { };
        return done(err, action, data);
      }
      if (++completed >= candidate) return done(null, data);
    };
    actions.forEach(function (action, idx) {
      try {
        handler(action, data, function next(err, res, execMsg) {
          if (res && action.id) data[action.id] = res;
          callback.call(action, err);
        });
      } catch (ex) {
        callback.call(action, ex);
      }
    });
  },

  /**
   * Helper to invoke Serial action
   * @param actions
   * @param handler
   * @param data
   * @param done
   */
  serial: function(actions, handler, data, done) {
    var idx = 0, action = null;
    if (typeof data === "function") {
      done = data;
      data = {};
    } else if (!data) {
      data = {};
    }
    var next = function (err, res, execMsg) {
      if (res && action) data[action.id] = res;
      if (err) {
        return done(err, action, data);
      }
      if (idx < actions.length) {
        action = actions[idx++];
        try {
          handler(action, data, next);
        } catch (ex) {
          return done(ex, action, data);
        }
      }
      else done(null, data);
    };
    next();
  }
};
const writeChannelsM3U = function(chs, { singleActive=true, direct=false} = {}) {
  if (chs && Array.isArray(chs)) {
    const fstrm = fs.createWriteStream(`${chs.fileName}.m3u`, {
      flags: 'w',
      defaultEncoding: 'utf8',
      fd: null,
      mode: 0o666,
      autoClose: true
    });
    fstrm.write("#EXTM3U\n");
    chs.sort((f,s) => { if (f.cat === s.cat) return (f.name > s.name)?1:-1; return (f.cat > s.cat) ? 1 : -1; });
    chs.forEach((c) => {
      console.log(c);
      if (c.cat) c.cat = c.cat.replace("-", ":");
      fstrm.write(`\n#EXTINF:-1 group-title=${c.cat} tvg-name="${c.name}" tvg-logo="${c.name}.png",${c.name.replace(/[ \t]+-[ \t]+WWW\.FREELIVE365\.COM/,'(FREELIVE365.COM)')} (${c.cat})`);
      if (direct) {
        const cid = c.url||c.cid;
        let param = `id=${cid}`;
        if (cid.startsWith('magnet:')) {
          param = `infohash=${cid.substring('magnet:'.length)}`
        } else if (cid.startsWith('http')) {
          param = `url=${cid}`
        }
        fstrm.write(`\nhttp://${SERVERIP}:6878/ace/manifest.m3u8?${param}`);
      } else {
        fstrm.write(`\nhttp://${SERVERIP}:9088/?chid=${c.url||c.cid}&single=${singleActive}`);
      }
    })
    //fstrm.close();
    fstrm.on("close", () => {
        console.log("closing file");
    });
  }
};
const writeChannelsNP = function(chs) {
  if (chs && Array.isArray(chs)) {
    const fstrm = fs.createWriteStream(`${chs.fileName}.xml`, {
      flags: 'w',
      defaultEncoding: 'utf8',
      fd: null,
      mode: 0o666,
      autoClose: true
    });
    fstrm.write(`<?xml version="1.0" encoding="UTF-8" ?>
  <rss version="2.0">
    <channel>
`);
    chs.sort((f,s) => { if (f.cat === s.cat) return (f.name > s.name)?1:-1; return (f.cat > s.cat) ? 1 : -1; });
    chs.forEach((c) => {
      console.log(c);
      var url = `http://${SERVERIP}:9088/?chid=${c.url||c.cid}`;
      if (c.url && c.url.startsWith("http")) {
        url = c.url;
      }
      fstrm.write(`
     <item>
       <title>${c.name}</title><description></description>
       <enclosure url="${url}" type="video/rtsp" method="__derived" />
     </item>
 `);
    })
    fstrm.write(`
  </channel>
</rss>`
    );
    //fstrm.close();
    fstrm.on("close", () => {
        console.log("closing file");
    });
  }
};
const readm3u = function(data, channels, done, save) {
  if (save) {
    const fname = `${channels.fileName}.m3u`;
    fs.writeFile(fname, data, {
      flag: 'w',
      encoding: null,
      mode: 0o666}, (err) => {
      if (err) throw err;
      console.log(`Saved ${fname}!`);
    });
  }
  const lines = data.split("\n");
  let ch = null;
  lines.forEach((line, i) => {
    console.log(line);
    if (line.indexOf("#EXTINF:") === 0) {
      ch = {};
      const i = line.lastIndexOf(",");
      ch.name = (i >= 0) ? line.substring(i+1) : line.replace("#EXTINF:","");
    } else if (line.length > 0 && !line.startsWith("#")) {
      if (!ch) ch = {name: line}; //We should not hit this.
      ch.url = line.replace("192.168.1.135",SERVERIP);
      //ch.url = line;
      console.log(ch);
      channels.push(ch);
      ch = null;
    }
  });
  done(null, channels);
};

const readsop = function(data, channels, done, save) {
  const sopregex = /<channel id="(\d+)" .*?><name.*?>([^<]+)<\/name><status>(\d)<\/status>.*?<class.*?en="([^"]+)".*?<\/class>.*?<sop_address><item>([^<]+)<\/item><\/sop_address>.*?<\/channel>/g;
  let result;
  while ((result = sopregex.exec(data)) !== null) {
    const ch = {
      id: result[1],
      name: result[2],
      status: result[3],
      cat: result[4],
      url: result[5],
    };
    console.log(ch);
    channels.push(ch);
  }
  done(null, channels);
};

const readace = function(data, channels, done) {
  const parsedData = JSON.parse(data.trim());
  //console.log(parsedData);
  const chs = Array.isArray(parsedData) ? parsedData : parsedData.channels;
  if (chs && Array.isArray(chs)) {
    chs.forEach((c) => {
      let name = c.name;
      try {
        name = decodeURIComponent(c.name);
      } catch(ex) {
        console.log(`couldn't decode ${c.name}`);
      }
      c.availability_updated_at > 0 && (c.availability_updated_at = new Date(c.availability_updated_at*1000).toJSON());
      channels.push({
        infohash: c.infohash,
        name: `${name} [${c.availability_updated_at}][${c.availability}]`,
        status: c.availability === 1?'online':'offline',
        cat: Array.isArray(c.categories) && c.categories[0] || '',
        url: `magnet:${c.infohash}`,
      });
    });
    console.log(`After get: Channel Count ${channels.length} - Got ${chs.length}`);
  }
  done(null, channels);
}

const readjson = function(data, channels, done) {
  const parsedData = JSON.parse(data.trim());
  //console.log(parsedData);
  const chs = Array.isArray(parsedData) ? parsedData : parsedData.channels;
  if (chs && Array.isArray(chs)) {
    chs.forEach((c) => { channels.push(c); });
    console.log(`After get: Channel Count ${channels.length} - Got ${chs.length}`);
  }
  done(null, channels);
}

const getChannels = function(url, channels, done) {
  if (!url.startsWith("http")) {
    try {
      const fdata = fs.readFileSync(url, {
        flag: 'r',
        encoding: null,
      });
      channels.handler(fdata, channels, done);
    } catch(e) {
      console.error(e);
      done(e);
    }
    return;
  }
  const headers = {
'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
'Accept-Encoding': 'gzip, deflate, br',
'Accept-Language': 'en-US,en;q=0.9',
'Cache-Control': 'no-cache',
'Connection': 'keep-alive',
'DNT': '1',
'Pragma': 'no-cache',
'Upgrade-Insecure-Requests': '1',
'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36',
};
  console.log(mUrl.parse(url));
  const optns = Object.assign({method:'GET', rejectUnauthorized: false, minVersion: 'TLSv1', headers}, {});//, mUrl.parse(url));
  console.log(optns);
    
  console.log('before get');
  const httpModule = url.startsWith('http://') && http || https;
  httpModule.get(url, optns,
   (res) => {
      const statusCode = res.statusCode;
      const contentType = res.headers['content-type'];
      if (statusCode !== 200) {
        const err = new Error(`Request Failed to ${url}.\nStatus Code: ${statusCode}`);
        console.error(err);
        done(err);
        return;
      }
      const contentEncoding = res.headers['content-encoding'];
      const output = process.stdout;
      console.log(contentEncoding);
      let out;
      switch (contentEncoding) {
        case 'br':
          out = zlib.createBrotliDecompress();
          res.pipe(out);//.pipe(output);
          break;
        // Or, just use zlib.createUnzip() to handle both of the following cases:
        case 'deflate':
          out = zlib.createInflate();
          res.pipe(out);//.pipe(output);
          break;
        case 'gzip':
          out = zlib.createGunzip();
          res.pipe(out);//.pipe(output);
          break;
        default:
          out = res;
          break;
      }
      
      //out.setEncoding('utf8');
      //out.setEncoding('binary');
      let rawData = [];

      out.on('data', (chunk) => { 
        //rawData += chunk;
        rawData.push(chunk); 
        //console.log(chunk);
      });
      out.on('end', () => {
        try {
          //console.log(Buffer.concat(rawData).toString());
          const buf = Buffer.concat(rawData);
          //const buf = zlib.unzipSync(Buffer.concat(rawData));
          const data = buf.toString('utf8');
          console.log(data);
          channels.handler(data, channels, done, true);
        } catch (e) {
          console.error(`BAD DATA`, e);
          done(e);
        }
      });
  }).on('error', (e) => {
      console.log(`Got error: ${e.message}`);
      done(e);
  });
};

const singleActive = true;
const direct = false;
function ttv() {
  return new Promise((resolve, reject) => {
    const channels = [];
    channels.handler = readjson;
    channels.fileName = "ttv"; //"torrent-tv";
    invoker.parallel([
      //"http://torrent-telik.com/channels/torrent-tv.json", 
      //"http://pomoyka.win/trash/ttv-list/ttv.json",
      //"http://pomoyka.lib.emergate.net/trash/ttv-list/acelive.json",
      "http://91.92.66.82/trash/ttv-list/acelive.json", //https://www.zona-iptv.ru/p/super-pomoyka_30.html
    ], getChannels, channels,
      (err, d) => { 
        if (err) return void reject(err);
        writeChannelsM3U(channels, { singleActive, direct }); 
        //writeChannelsNP(channels); 
        resolve();
    });
  });
}
function ace() {
  return new Promise((resolve, reject) => {
    const channels = [];
    channels.handler = readace;
    channels.fileName = "ace";
    invoker.parallel([
      // Refer http://wiki.acestream.org/wiki/index.php/Search_API. 
      // For local search get token using http://127.0.0.11:6878/server/api?method=get_api_access_token
      // and http://127.0.0.1:6878/server/api/?method=search&query=sport&page_size=100&token=zzzz
      // "https://search.acestream.net/all?api_version=1.0&api_key=test_api_key"
      "https://api.acestream.me/all?api_version=1.0&api_key=test_api_key"
    ], getChannels, channels,
      (err, d) => { 
        if (err) return void reject(err);
        writeChannelsM3U(channels, { singleActive, direct }); 
        //writeChannelsNP(channels); 
        resolve();
    });
  });
}
/*
function ttvn() {
  return new Promise((resolve, reject) => {
    const channels = [];
    channels.handler = readm3u;
    channels.fileName = "ttvn"; //"torrent-tvn";
    invoker.parallel([
      "http://asproxy.net/n/CdtcLl1cjM/4100", 
      //"http://super-pomoyka.us.to/trash/ttv-list/acelive.json",
      ], getChannels, channels,
      (err, d) => { 
        if (err) return void reject(err);
        //writeChannelsM3U(channels); 
        writeChannelsNP(channels); 
        resolve();
    });
  });
}
*/
function sop() {
  return new Promise((resolve, reject) => {
    const channels = [];
    channels.handler = readsop;
    channels.fileName = "sop-tv";
    invoker.parallel([
      //"http://streams.magazinmixt.ro/sopcast.xml", 
      //"http://tvdot.tk/sopcast.xml",
      "http://www.sopcast.com/chlist.xml",
      ], getChannels, channels,
      (err, d) => { 
        if (err) return void reject(err);
        writeChannelsM3U(channels); 
        //writeChannelsNP(channels); 
        resolve();
    });
  });
}
(async function run() {
  const promises = [/*ttv,*/ ace, /*sop*/].map((fn => fn()));;
  await Promise.all(promises);
})().then(() => {
  console.log('done');
}).catch(console.error);
