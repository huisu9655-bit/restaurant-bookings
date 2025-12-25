#!/bin/bash

# # 优化镜内下载镜像速度
# # 将境外镜像在 pull 到本地
# docker pull openjdk:8-jdk-alpine
# # 将基础镜像 push 到阿里云镜像仓库
# docker tag openjdk:8-jdk-alpine registry.cn-hangzhou.aliyuncs.com/yangoo-pub/openjdk:8-jdk-alpine
# docker push registry.cn-hangzhou.aliyuncs.com/yangoo-pub/openjdk:8-jdk-alpine
# # 修改 Dockerfile 中 FROM 为 FROM registry.cn-hangzhou.aliyuncs.com/yangoo-pub/openjdk:8-jdk-alpine
image_name='restaurant-bookings'
version=$(date "+%Y%m%d-%H%M%S")

# maven build default command
# mvn -B clean package -Dmaven.test.skip=true -Dautoconfig.skip

# 打包
docker build . -t registry.cn-hangzhou.aliyuncs.com/yangoo/${image_name}:${version}
# 推送
docker push registry.cn-hangzhou.aliyuncs.com/yangoo/${image_name}:${version}

# 标记最新版tag
docker tag registry.cn-hangzhou.aliyuncs.com/yangoo/${image_name}:${version} registry.cn-hangzhou.aliyuncs.com/yangoo/${image_name}:latest
# 推送
docker push registry.cn-hangzhou.aliyuncs.com/yangoo/${image_name}:latest
