# ace

# building

```
 $ docker build -t ace:latest .
```

# running

```
$ docker run -it -p 9088:9088 -p 6689:6689 -p 127.0.0.1:6878:6878 -e DEBUG=* ace
```

# playing

For playing URL:
```
http://127.0.0.1:9088/?chid=<url>&single=true
```
For playing INFOHASH
```
http://127.0.0.1:9088/?chid=magnet:<infohash>&single=true
```

Pass `single=false` to play multiple channels.

# Accessing server from external player

Running nginx with following configuration is an option.

```
  server {
    listen       80;

    location / {
      root   html/playlist;
      index  index.html index.htm;
    }
    location /content/ {
      proxy_pass http://127.0.0.1:6878;
      proxy_redirect off;
      proxy_pass_header Set-Cookie;
      log_subrequest on;
    }
    location /hls/ {
      proxy_pass http://127.0.0.1:6878;
      proxy_redirect off;
      proxy_pass_header Set-Cookie;
      log_subrequest on;
    }
    location /ace/ {
      proxy_pass http://127.0.0.1:6878;
      proxy_pass_header Set-Cookie;
      proxy_redirect http://127.0.0.1:6878/ http://$host/;
      sub_filter_types application/vnd.apple.mpegurl;
      sub_filter 'http://127.0.0.1:6878/' 'http://$host/';
      sub_filter_once off;
      log_subrequest on;
    }
  }
```
