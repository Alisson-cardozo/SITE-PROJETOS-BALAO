FROM php:8.3-fpm-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      libpng-dev \
      libjpeg62-turbo-dev \
      libfreetype6-dev \
      libzip-dev \
      unzip \
      curl \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) pdo_mysql gd zip opcache \
    && rm -rf /var/lib/apt/lists/*

# Upload maior (PDF / bandeiras)
RUN { \
      echo 'upload_max_filesize=25M'; \
      echo 'post_max_size=30M'; \
      echo 'memory_limit=256M'; \
      echo 'max_execution_time=120'; \
    } > /usr/local/etc/php/conf.d/uploads.ini

WORKDIR /var/www/backend

COPY backend/ /var/www/backend/

RUN mkdir -p /var/www/backend/public/uploads /var/www/backend/storage/logs \
    && chown -R www-data:www-data /var/www/backend/public/uploads /var/www/backend/storage

USER www-data

EXPOSE 9000
CMD ["php-fpm"]
