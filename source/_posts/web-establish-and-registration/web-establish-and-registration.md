---
title: 网站的搭建和备案(Wordpress版)
comments: true
toc: true
donate: true
share: true
date: 2025-01-07 11:36:37
categories: 实用技巧
tags:
- 技巧
---
注意，本网站搭建环境是基于兼容centos的linux发行版和apache、mariadb、php8搭建的，如果需要使用Debian系或其他发行版(Arch、Gentoo、FreeBSD等）请使用搜索引擎搜索相应教程，并根据该教程以及具体实际来修改安装，不可完全照抄。因搭建时间为3年前，可能会跟现有文档有出入。

本页面将会对帮助页面进行一定的解释。

## 搭建一个网站

### 选择服务器

在中国大陆地区，请使用阿里云、腾讯云、华为云等搭建服务器，境外可选择谷歌、亚马逊、Oracle、Auzure等，当然也可自行组装服务器。建议选择Centos、Debian作为首选系统（教程多，遇到错误好百度）。

注意，中国大陆需要包括购买域名、ICP备案以及公安备案。

### 搭建环境

本篇将以Wordpress安装教程（[娄老师](https://home.cnblogs.com/u/rocedu/)）为[模板](https://www.cnblogs.com/rocedu/p/16929895.html)进行安装。

```shell
# 安装Apache
[root@ecs-dbxx ~]# yum install -y httpd
# 开启Apache
[root@ecs-dbxx ~]# systemctl start httpd.service
```

安装MariaDB（mysql社区开源分支）

```shell
# 安装命令
[root@ecs-dbxx ~]# yum install -y mariadb-server
# 开启MariaDB
[root@ecs-dbxx ~]# systemctl start mariadb
[root@ecs-dbxx ~]# systemctl enable mariadb
```

```shell
# 通过下面命令给mariadb数据库的root账户设置密码123456:
mysqladmin -uroot password '123456'

# 修改数据库root密码
mysql> ALTER USER 'root'@'localhost' IDENTIFIED WITH \
mysql_native_password BY '新密码';

```

(注：*新密码*替换成**自己的密码**)

通过下面命令安装PHP和PHP模块:

```shell
[root@ecs-dbxx ~]# yum install -y php
[root@ecs-dbxx ~]# yum install -y php-mysqlnd php-fpm php-opcache php-cli \
php-curl php-dom php-exif php-fileinfo php-gd php-hash php-json php-mbstring \
php-mysqli php-openssl php-pcre php-xml libsodium
```

通过下面命令安装交互更加良好的nano 文本编辑器:

```shell
[root@ecs-dbxx ~]# yum install -y nano
```

### 安装部署wordpress

以下为部分工具的安装和部署

```shell
# 通过下面命令安装wget：
[root@ecs-dbxx ~]# yum install -y wget

# 通过下面命令请求wordpress安装包（.ZIP）：
[root@ecs-dbxx ~]# wget https://cn.wordpress.org/latest-zh_CN.zip

# 通过下面命令安装unzip解压工具：
[root@ecs-dbxx ~]# yum install -y unzip
```

```shell
# 通过下面命令登录到mariadb：
[root@ecs-dbxx ~]# mysql -uroot -p

# 通过下面命令创建WordPress数据库：
mysql> create database wordpressdb;
```

解压和赋权

```shell
# 解压latest-zh_CN.zip到/var/www目录下
# 当然，如果仅安装一个博客，可以把wordpress中的所有文件直接放在www目录内
# 再删掉wordpress文件夹
[root@ecs-dbxx ~]# unzip latest-zh_CN.zip -d /var/www

# 通过下面命令创建用户给Apache权限：
[root@ecs-dbxx ~]# chown -R apache:apache /var/www/wordpress
[root@ecs-dbxx ~]# chmod -R 755 /var/www/wordpress/

# 访问你的服务器公网ip
http://你的服务器公网IP/wp-config.php(www根目录安装)
http://你的服务器公网IP/wordpress/wp-config.php(wordpress目录安装)
```

```ini
# 修改php.ini来使得超过4mb大小的文件上传至wordpress（比如本网站的主题）
# 推荐使用vim/nano修改以下代码后的数字（已经修改了的放在下面了）

# 在php.ini内修改
upload_max_filesize = 64M
post_max_size = 128M
memory_limit = 256M
max_execution_time = 300
max_input_time = 300
```

至此，简单的步骤说明已经完成，遇到问题可使用必应或百度或谷歌自行搜索。

## 如何添加备案及示例

[阿里云](https://help.aliyun.com/zh/icp-filing/support/website-to-add-the-record-number-faq#:~:text=%E7%BD%91%E7%AB%99%E6%B7%BB%E5%8A%A0%E5%A4%87%E6%A1%88%E5%8F%B7FAQ%201%20%E5%A6%82%E4%BD%95%E5%9C%A8%E7%BD%91%E7%AB%99%E5%BA%95%E9%83%A8%E6%B7%BB%E5%8A%A0%E5%A4%87%E6%A1%88%E5%8F%B7%EF%BC%9F%20ICP%E5%A4%87%E6%A1%88%E6%88%90%E5%8A%9F%E5%90%8E%EF%BC%8C%E6%82%A8%E9%9C%80%E8%A6%81%E5%9C%A8ICP%E5%A4%87%E6%A1%88%E6%88%90%E5%8A%9F%E7%9A%84%E7%BD%91%E7%AB%99%E5%BA%95%E9%83%A8%E6%82%AC%E6%8C%82%E5%B7%A5%E4%BF%A1%E9%83%A8%E4%B8%8B%E5%8F%91%E7%9A%84ICP%E5%A4%87%E6%A1%88%E5%8F%B7%EF%BC%8C%E5%B9%B6%E7%94%9F%E6%88%90%E9%93%BE%E6%8E%A5%E6%8C%87%E5%90%91%20%E5%B7%A5%E4%BF%A1%E9%83%A8%E7%BD%91%E7%AB%99%EF%BC%9Abeian.miit.gov.cn%20%E3%80%82%20%E5%A6%82%E6%9E%9C%E6%9C%AA%E5%9C%A8%E7%BD%91%E7%AB%99%E5%BA%95%E9%83%A8%E6%B7%BB%E5%8A%A0ICP%E5%A4%87%E6%A1%88%E5%8F%B7%EF%BC%8C%E8%A2%AB%E7%9B%B8%E5%85%B3%E9%83%A8%E9%97%A8%E6%A0%B8%E6%9F%A5%E5%87%BA%E6%9D%A5%E5%B0%86%E5%A4%84%E4%BB%A5%E4%BA%94%E5%8D%83%E5%85%83%E4%BB%A5%E4%B8%8A%E4%B8%80%E4%B8%87%E5%85%83%E4%BB%A5%E4%B8%8B%E7%BD%9A%E6%AC%BE%E3%80%82%20%E5%A6%82%E6%82%A8%E4%B8%8D%E7%9F%A5%E9%81%93%E5%A6%82%E4%BD%95%E6%82%AC%E6%8C%82ICP%E5%A4%87%E6%A1%88%E5%8F%B7%EF%BC%8C%E5%8F%AF%E5%9C%A8%E9%98%BF%E9%87%8C%E4%BA%91%E5%B8%82%E5%9C%BA%E6%90%9C%E7%B4%A2%E7%9B%B8%E5%85%B3%E4%BB%A3%E5%8A%9E%E6%9C%8D%E5%8A%A1%EF%BC%8C%E7%94%B1%E4%B8%93%E4%B8%9A%E4%BA%BA%E5%91%98%E4%B8%BA%E6%82%A8%E6%82%AC%E6%8C%82%E7%BD%91%E7%AB%99ICP%E5%A4%87%E6%A1%88%E5%8F%B7%E3%80%82,%E7%9B%B4%E6%8E%A5%E6%8C%87%E5%90%91%EF%BC%9A%20%E5%A6%82%E6%82%A8%E7%9B%B4%E6%8E%A5%E5%B0%86%E5%A4%9A%E4%B8%AA%E5%9F%9F%E5%90%8D%EF%BC%8C%E5%90%8C%E6%97%B6%E6%8C%87%E5%90%91%E5%90%8C%E4%B8%80%E9%A1%B5%E9%9D%A2%E3%80%82%20...%203%20%E7%BD%91%E7%AB%99%E6%B2%A1%E6%9C%89%E5%BC%80%E9%80%9A%E4%BD%BF%E7%94%A8%EF%BC%8C%E9%9C%80%E8%A6%81%E5%9C%A8%E7%BD%91%E7%AB%99%E5%BA%95%E9%83%A8%E6%B7%BB%E5%8A%A0%E5%A4%87%E6%A1%88%E5%8F%B7%E5%90%97%EF%BC%9F%20%E7%BD%91%E7%AB%99%E5%9F%9F%E5%90%8D%E5%B7%B2%E5%A4%87%E6%A1%88%E4%B8%94%E7%BD%91%E7%AB%99%E6%AD%A3%E5%B8%B8%E8%BF%90%E8%90%A5%E4%B8%AD%EF%BC%9A%20%E5%A6%82%E6%9E%9C%E7%BD%91%E7%AB%99%E5%AF%B9%E5%BA%94%E7%9A%84%E5%9F%9F%E5%90%8D%E5%B7%B2%E7%BB%8F%E5%A4%87%E6%A1%88%E6%88%90%E5%8A%9F%EF%BC%8C%E6%A0%B9%E6%8D%AE%E7%9B%B8%E5%85%B3%E8%A7%84%E5%AE%9A%EF%BC%8C%E7%BD%91%E7%AB%99%E5%BF%85%E9%A1%BB%E5%A4%84%E4%BA%8E%E5%8F%AF%E8%AE%BF%E9%97%AE%E7%9A%84%E7%8A%B6%E6%80%81%E3%80%82%20)版本

```html
<a href="https://beian.miit.gov.cn/" target="_blank">您的备案号</a>

#比如以下示例
<a href="https://beian.miit.gov.cn/" target="_blank">浙B2-20080101</a>
```

**PS**：复制含有备案信息的代码，回到自己的后台粘贴，修改为自己的备案号及图片地址即可。
