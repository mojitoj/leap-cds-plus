function attributeValueFromArray(attributeArray, attributeId) {
  const theAttribute = attributeArray.filter(
    ({ AttributeId }) => AttributeId === attributeId
  );
  return theAttribute?.[0]?.Value;
}

function xacmlRequestToContext(xacmlRequest) {
  const patientId = attributeValueFromArray(
    xacmlRequest?.Request?.Resource?.[0]?.Attribute,
    "patientId"
  );

  const category = attributeValueFromArray(
    xacmlRequest?.Request?.Action?.[0]?.Attribute,
    "category"
  );

  const purposeOfUse = attributeValueFromArray(
    xacmlRequest?.Request?.Action?.[0]?.Attribute,
    "purposeOfUse"
  );

  const actor = attributeValueFromArray(
    xacmlRequest?.Request?.AccessSubject?.[0]?.Attribute,
    "actor"
  );

  return {
    patientId,
    category,
    actor,
    purposeOfUse
  };
}

module.exports = { attributeValueFromArray, xacmlRequestToContext };
