# Serves the web/dist that deploy-web.yml already built on the runner.
# The build is not a stage here because web/ is an npm workspace sharing the
# root package-lock.json, so building inside Docker would mean shipping the
# whole monorepo as the build context.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html

EXPOSE 8080
