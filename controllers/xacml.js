const { xacmlRequestToContext } = require("../lib/xacml");
const { validateXacmlRequest } = require("../lib/validators");
const { asXacmlResponse } = require("../lib/consent-decision-xacml");
const { processDecision } = require("../lib/consent-processor");
const { fetchConsents } = require("../lib/consent-discovery");
const logger = require("../lib/logger");

async function post(req, res, next) {
  validateXacmlRequest(req);

  const context = xacmlRequestToContext(req.body);
  const category = context.category || [];

  const consentsBundle = await fetchConsents(context.patientId, category);
  const decisionEntry = await processDecision(consentsBundle, context);

  logger.debug(
    `Request: , Consents: ${consentsBundle.map(
      ({ fullUrl }) => fullUrl
    )}, Decision: ${JSON.stringify(decisionEntry)}`
  );

  res.send(asXacmlResponse(decisionEntry));
}

module.exports = {
  post
};
