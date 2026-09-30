FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
# Dependencias de producción: postgres (Supabase) y @electric-sql/pglite (base local).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
# Migraciones: PGlite las aplica al arrancar si no hay DATABASE_URL.
COPY supabase ./supabase
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
# Con DATABASE_URL usa Postgres (Supabase); sin ella, PGlite en /data/pglite.
CMD ["node", "server/index.js"]
