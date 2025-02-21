const _ = require("lodash");
const nock = require("nock");

const request = require("supertest");
const { app } = require("../../app");
const {
  setupMockConsent,
  setupMockAuditEndpoint
} = require("../common/setup-mock-consent-servers");

const CONSENT_OPTIN = require("../fixtures/consents/r4/consent-boris-optin.json");
const CONSENT_OPTOUT = require("../fixtures/consents/r4/consent-boris-optout.json");

const ENDPOINT = "/xacml";

afterEach(() => {
  nock.cleanAll();
});

const REQUEST = require("../fixtures/request-samples/xacml-request.json");

const ORGANIZATION = require("../fixtures/organizations/org-good-health.json");

it("should return 200 and a permit card with an OPTIN consent", async () => {
  expect.assertions(2);

  setupMockAuditEndpoint();
  setupMockConsent(CONSENT_OPTIN);

  const res = await request(app)
    .post(ENDPOINT)
    .set("Accept", "application/json")
    .send(REQUEST);
  expect(res.status).toEqual(200);
  expect(res.body).toMatchObject({
    Response: expect.arrayContaining([
      expect.objectContaining({ Decision: "Permit", Obligations: [] })
    ])
  });
});

it("should return 200 and a deny response with an OPTIN consent and provision with a matching prohibited recipient", async () => {
  expect.assertions(2);

  setupMockAuditEndpoint();
  setupMockConsent(CONSENT_OPTIN);

  const REQUEST_WITH_PROHIBITED_ACTOR = _.set(
    _.cloneDeep(REQUEST),
    "Request.AccessSubject[0].Attribute[0].Value",
    [ORGANIZATION.identifier[0]]
  );

  const res = await request(app)
    .post(ENDPOINT)
    .set("Accept", "application/json")
    .send(REQUEST_WITH_PROHIBITED_ACTOR);
  expect(res.status).toEqual(200);
  expect(res.body).toMatchObject({
    Response: expect.arrayContaining([
      expect.objectContaining({ Decision: "Deny", Obligations: [] })
    ])
  });
});

it("should return 200 and a deny response with an OPTOUT consent", async () => {
  expect.assertions(2);
  setupMockAuditEndpoint();
  setupMockConsent(CONSENT_OPTOUT);

  const res = await request(app)
    .post(ENDPOINT)
    .set("Accept", "application/json")
    .send(REQUEST);
  expect(res.status).toEqual(200);
  expect(res.body).toMatchObject({
    Response: expect.arrayContaining([
      expect.objectContaining({ Decision: "Deny", Obligations: [] })
    ])
  });
});

it("should return 200 and a consent permit response with obligations when a consent with security label provisions applies", async () => {
  expect.assertions(2);

  const ACTIVE_PRIVACY_CONSENT_WITH_SEC_LABEL_PROVISION = require("../fixtures/consents/r4/consent-boris-deny-restricted-label.json");

  setupMockAuditEndpoint();
  setupMockConsent(ACTIVE_PRIVACY_CONSENT_WITH_SEC_LABEL_PROVISION);

  const REQUEST_WITH_PROHIBITED_ACTOR = _.set(
    _.cloneDeep(REQUEST),
    "Request.AccessSubject[0].Attribute[0].Value",
    [ORGANIZATION.identifier[0]]
  );

  const res = await request(app)
    .post(ENDPOINT)
    .set("Accept", "application/json")
    .send(REQUEST_WITH_PROHIBITED_ACTOR);

  expect(res.status).toEqual(200);
  expect(res.body).toMatchObject({
    Response: expect.arrayContaining([
      expect.objectContaining({
        Decision: "Permit",
        Obligations: [
          {
            Id: {
              system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
              code: "REDACT"
            },
            AttributeAssignment: [
              {
                AttributeId: "codes",
                Value: [
                  {
                    system:
                      "http://terminology.hl7.org/CodeSystem/v3-Confidentiality",
                    code: "R"
                  }
                ]
              }
            ]
          }
        ]
      })
    ])
  });
});

it("should return 200 and an array including a NO_CONSENT card when no consent exists", async () => {
  expect.assertions(2);

  setupMockConsent(null);

  const res = await request(app)
    .post(ENDPOINT)
    .set("Accept", "application/json")
    .send(REQUEST);
  expect(res.status).toEqual(200);
  expect(res.body).toMatchObject({
    Response: expect.arrayContaining([
      expect.objectContaining({
        Decision: "NotApplicable",
        Obligations: []
      })
    ])
  });
});
