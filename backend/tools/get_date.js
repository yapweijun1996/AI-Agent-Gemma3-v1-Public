module.exports = {
  name: "GET_DATE",
  description: "Get the current date and time.",
  parametersSchema: {},
  async run(params, context) {
    return { reply: new Date().toLocaleString() };
  }
}; 