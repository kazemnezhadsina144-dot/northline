FROM node:22-alpine
WORKDIR /app
COPY build/cowswap ./build/cowswap
COPY tools/serve-northline.mjs ./tools/serve-northline.mjs
ENV PORT=3410
EXPOSE 3410
CMD ["node", "tools/serve-northline.mjs"]
