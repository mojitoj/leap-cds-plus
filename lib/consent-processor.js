const _ = require("lodash");
const { codesIntersection, codesUnion } = require("./codes");
const Obligations = require("./obligations");
const AuditService = require("./audit");

const {
  CONSENT_PERMIT,
  CONSENT_DENY,
  NO_CONSENT,
  flipConsentDecision
} = require("./consent-decisions");

const { processProvision, matchPurposeOfUse } = require("./consent-provisions");

async function processDecision(consentBundles, query) {
  const consentDecisions = consentBundles
    .map((consentBundle) =>
      consentBundle.consents.map((consent) => ({
        ...consentDecision(consent, consentBundle.referencedResources, query),
        fhirBase: consentBundle.fhirBase
      }))
    )
    .flat();

  const applicableConsentDecisions = consentDecisions.filter(
    (aDecision) => aDecision?.decision !== NO_CONSENT
  );

  const finalDecision = applicableConsentDecisions.reduce(
    mostRecentDecisionCombiner,
    {
      decision: NO_CONSENT,
      obligations: [],
      dateTime: "1970-01-01"
    }
  );

  await AuditService.maybeRecordAudit(finalDecision, query);

  return finalDecision;
}

const period = (consent) =>
  consent?.period || //R5
  consent?.provision?.period; //R4;

const isActive = (consent) => consent.status === "active";

function isValid(consent) {
  const periodStart = period(consent)?.start;
  const periodEnd = period(consent)?.end;

  return (
    (!periodStart || Date.now() >= new Date(periodStart).valueOf()) &&
    (!periodEnd || Date.now() <= new Date(periodEnd).valueOf())
  );
}

function matchesCategory(consent, query) {
  const untrimmedCategories = consent.category || [];
  const untrimmedQueriedCategories = query.category || [];
  const categories = untrimmedCategories
    .map((categoryCode) => categoryCode?.coding)
    .flat()
    .map(({ system, code }) => ({ system, code }))
    .filter((category) => category);

  const queriedCategories = untrimmedQueriedCategories.map(
    ({ system, code }) => ({ system, code })
  );

  return (
    !query.category || codesIntersection(queriedCategories, categories).length
  );
}

function mostRecentDecisionCombiner(currentCandidate, thisConsentDecision) {
  const thisConsentIsLessRecent =
    new Date(thisConsentDecision.dateTime) <
    new Date(currentCandidate.dateTime);

  return thisConsentIsLessRecent ? currentCandidate : thisConsentDecision;
}

function denyOverrideDecisionCombiner(currentCandidate, thisDecision) {
  const decision =
    thisDecision.decision === CONSENT_DENY
      ? { decision: CONSENT_DENY }
      : currentCandidate.decision === NO_CONSENT
        ? thisDecision
        : currentCandidate;

  const obligations =
    decision === CONSENT_DENY
      ? []
      : codesUnion(thisDecision.obligations, currentCandidate.obligations);
  return {
    ...decision,
    obligations
  };
}

function defaultDecision(consent) {
  const baseDecision =
    consent?.decision || //R5
    consent?.provision?.type; //R4
  return baseDecision === "deny"
    ? CONSENT_DENY
    : baseDecision === "permit"
      ? CONSENT_PERMIT
      : NO_CONSENT;
}

const patient = (consent) =>
  consent.subject || //R5
  consent.patient; //R4

const date = (consent) =>
  consent.date || //R5
  consent.dateTime;

function provisions(consent) {
  const firstProvision = consent.decision
    ? consent.provision //R5
    : consent.provision?.provision; //R4

  return (firstProvision ? [firstProvision].flat() : []).filter(
    (provision) => provision
  );
}

const consentIsApplicable = (consent, query) =>
  !isActive(consent) ||
  !isValid(consent) ||
  !matchesCategory(consent, query) ||
  !matchPurposeOfUse(consent.provision, query);

function consentDecision(consent, referencedResources, query) {
  if (consentIsApplicable(consent, query))
    return { decision: NO_CONSENT, obligations: [] };

  const baseDecision = defaultDecision(consent);

  const provisionResults = provisions(consent).map((provision) =>
    processProvision(provision, referencedResources, query, baseDecision)
  );

  const matchedProvisions = provisionResults.filter(({ match }) => match);

  const decision = matchedProvisions.some(
    ({ obligations }) => !obligations.length
  )
    ? flipConsentDecision(baseDecision)
    : baseDecision;

  const baseObligations = matchedProvisions
    .map(({ obligations }) => obligations)
    .flat();
  const obligations =
    decision == CONSENT_PERMIT ? combineObligations(baseObligations) : [];

  const adjustedDecision = adjustDecision(query, decision, obligations);

  return {
    ...adjustedDecision,
    dateTime: date(consent),
    id: `Consent/${consent?.id}`,
    patientId: patient(consent)
  };
}

function adjustDecision(query, decision, obligations) {
  const requestedContentClasses = query?.class ? [query.class].flat() : [];
  const redactedContentClass = Obligations.redactedContentClasses(obligations);

  return codesIntersection(requestedContentClasses, redactedContentClass).length
    ? {
        decision: CONSENT_DENY,
        obligations: []
      }
    : { decision, obligations };
}

function combineObligations(obligations) {
  const obligationsGroupedById = _.mapValues(
    _.groupBy(obligations, (obligation) => JSON.stringify(obligation.id)),
    (bucket) => bucket.map(({ parameters }) => parameters)
  );

  const rawCombinedObligations = _.mapValues(
    obligationsGroupedById,
    (parameters) => ({
      codes: parameters.reduce(
        (acc, thisOne) => _.union(acc, thisOne?.codes),
        []
      ),
      exceptAnyOfCodes: parameters.reduce(
        (acc, thisOne) => _.union(acc, thisOne?.exceptAnyOfCodes),
        []
      )
    })
  );

  const combinedObligations = Object.keys(rawCombinedObligations)
    .map((key) => ({
      id: JSON.parse(key),
      parameters: rawCombinedObligations?.[key]
    }))
    .map(removeEmptyCodeProperties);

  return combinedObligations;
}

const removeEmptyCodeProperties = (obligation) =>
  obligation.parameters.codes.length
    ? {
        id: obligation.id,
        parameters: { codes: obligation.parameters.codes }
      }
    : {
        id: obligation.id,
        parameters: {
          exceptAnyOfCodes: obligation.parameters.exceptAnyOfCodes
        }
      };

module.exports = {
  processDecision
};
