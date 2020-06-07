FROM ubuntu:18.04

ENV DEBIAN_FRONTEND noninteractive

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8

RUN apt-get -y update && \ 
    apt-get install -y \
            locales \
#            python-software-properties \
            software-properties-common \ 
            vim \
            unzip \
            wget \
            curl \
            net-tools \
            build-essential \
            python python-dev python-pip python-virtualenv \
            python-m2crypto python-apsw \
            git-core 
RUN locale-gen en_US.UTF-8

#https://launchpad.net/~mc3man/+archive/ubuntu/trusty-media
#RUN add-apt-repository -y ppa:mc3man/trusty-media && \
#    apt-get -y update && \
#    apt-get -y dist-upgrade && \
#    apt-get -y install ffmpeg
RUN apt-get -y install ffmpeg

#http://ubuntuhandbook.org/index.php/2015/07/install-sopcast-player-ubuntu-15-04/
#RUN dpkg --add-architecture i386 && \
#    apt-get -y update && \ 
#    apt-get -y install libstdc++5:i386 && \
#    #add-apt-repository -y ppa:lyc256/sopcast-player && \
#    #apt-get -y update && \
#    #apt-get -y install sp-auth
#    mkdir -p /opt/sopcast && \
#    wget -qO- http://download.sopcast.com/download/sp-auth.tgz | tar -C /opt/sopcast -xzf - && \
#    chown root:root /opt/sopcast/sp-auth && \
#    ln -s /opt/sopcast/sp-auth/sp-sc-auth /usr/local/bin/sp-sc


#RUN  mkdir -p /opt/sopcast && \
#     wget -qO- http://download.sopcast.com/download/sp-auth.tgz | tar -C /opt/sopcast -xzf - && \
#     chown root:root /opt/sopcast/sp-auth && \
#     ln -s /opt/sopcast/sp-auth/sp-sc-auth /usr/local/bin/sp-sc
            
   #wget http://nodejs.org/dist/node-latest.tar.gz && \
   #cd node-v* && \
   #./configure && \
   #CXX="g++ -Wno-unused-local-typedefs" make && \
   #CXX="g++ -Wno-unused-local-typedefs" make install && \
   #echo 'n# Node.jsnexport PATH="node_modules/.bin:$PATH"' >> /root/.bashrc
            
  #rm -rf /var/lib/apt/lists/*

#http://linux-user.ru/distributivy-linux/programmy-dlya-linux/noxbit-v-linux-ubuntu/
#RUN mkdir -p /opt/noxbit && \
#     chmod -R 777 /opt/noxbit && \
#     wget -qO- http://download.noxbit.com/noxbit-pa-x86-64.tar.gz | tar -C /opt/noxbit -xzf - 

#https://github.com/sybdata/ace3.1/blob/master/Dockerfile
#http://wiki.acestream.org/wiki/index.php/Download
ENV ACE_FILE acestream_3.1.49_ubuntu_18.04_x86_64
ENV ACE_DOWNLOAD http://acestream.org/downloads/linux/${ACE_FILE}.tar.gz
RUN cd / && mkdir -p /opt/acestream/${ACE_FILE} && \
     wget -qO- ${ACE_DOWNLOAD} | tar -C /opt/acestream/${ACE_FILE} -xzf - && \
     ln -s /opt/acestream/${ACE_FILE}/acestreamengine /usr/local/bin/acestreamengine

#ENV NODE_VERSION v12.18.0
ENV NODE_VERSION v10.16.0
RUN mkdir -p /opt/node && \
     wget -qO- http://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz | tar -C /opt/node -xzf - && \
     ln -s /opt/node/node-${NODE_VERSION}-linux-x64/bin/node /usr/local/bin/node && \
     ln -s /opt/node/node-${NODE_VERSION}-linux-x64/bin/npm /usr/local/bin/npm

RUN mkdir -p /server 

# Fix for bionic: It comes with m2crypto 0.27 which doesn't work with acestream
#RUN apt-get -y purge python-m2crypto && \
#    wget -qO- https://archive.archlinux.org/packages/p/python2-m2crypto/python2-m2crypto-0.34.0-1-x86_64.pkg.tar.xz | tar -C / -xJf - && \
#    mv /usr/lib/python2.7/site-packages/M2Crypto* /usr/lib/python2.7/dist-packages

WORKDIR /server
ENV PATH .:$PATH
#COPY ~/.vimrc /root/.vimrc
COPY proxy.js /server/proxy.js
COPY package.json /server/package.json
COPY player /server/player
COPY scripts/ace /server/ace
COPY scripts/ace /server/a
RUN chmod +x /server/ace /server/a
COPY scripts/sopcast /server/sopcast
COPY scripts/sopcast /server/s
RUN chmod +x /server/sopcast /server/s
#COPY scripts/noxbit /server/noxbit
#COPY scripts/noxbit /server/n
#RUN chmod +x /server/noxbit /server/n
RUN npm install
ENV ACEPORT 9088
ENV SOPPORT 9089

# TEMP FIX http://oldforum.acestream.media/index.php?topic=12448.msg26872#msg26872
COPY lib/py*.so /opt/acestream/${ACE_FILE}/lib/acestreamengine/
COPY lib/lib*.so* /opt/acestream/${ACE_FILE}/lib/
ENV LD_LIBRARY_PATH=/opt/acestream/${ACE_FILE}/lib

EXPOSE 9088 9089 6689 6878
# docker run -it -p 9088:9088 -p 9089:9089 -p 6689:6689 -p 127.0.0.1:6878:6878 -v $(pwd)/scripts:/server/scripts ace bash
#ENTRYPOINT ["acestreamengine", "--lib-path", ".", "--client-console"]
ENTRYPOINT node "/server/proxy.js" -p "${ACEPORT}" -i "/opt/acestream/${ACE_FILE}"
