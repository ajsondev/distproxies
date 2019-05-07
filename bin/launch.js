module.exports = (src) => {
  const admin = require('@nicomee/bt_backend-core');

  async function main() {
    await admin.config.load(); // load all your environment variables here
    require(src);
  }
  main();
};
