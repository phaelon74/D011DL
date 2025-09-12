// ecosystem.config.js
module.exports = {
  apps: [{
    name: "web-portal",
    script: "server.js",
    instances: "1",
    exec_mode: "fork",
    env: {
      PORT: 32001,
      API_BASE_URL: "http://api:32002",
      SESSION_SECRET: "change_me"
    }
  }]
};
