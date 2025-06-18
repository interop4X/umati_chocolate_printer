import http.client

conn = http.client.HTTPSConnection("4434960.online-server.cloud")

##ptw
payload = "  {\n    \"@id\": \"asset_hmi_demo_ptw\",\n    \"@type\": \"Asset\",\n    \"properties\": {\n      \"description\": \"MQTT Public Test\",\n      \"metadata.volume\": \"1Mb\",\n      \"id\": \"asset_hmi_demo_ptw\"\n    },\n    \"privateProperties\": {\n      \"assetOwner\": \"PTW\",\n      \"urn:dih-cloud:com:state\": \"active\"\n    },\n    \"dataAddress\": {\n      \"@type\": \"DataAddress\",\n      \"type\": \"Mqtt\",\n      \"keepAliveDuration\": \"PT600s\",\n      \"topic\": \"umati/v2/PTW/WerkzeugMaschine/MachineToolType/nsu=http:_2F_2FMachineTool_2Faggregation_5Fserver_2F;i=5004\",\n      \"mqtt.password\": \"w4IIqsEo0nna3N5V\",\n      \"mqtt.host.servers\": \"tcp://35.246.210.137:31883\",\n      \"mqtt.username\": \"umatiApp\",\n      \"id\": \"umatiApp\"\n    },\n    \"@context\": {\n      \"@vocab\": \"https://w3id.org/edc/v0.0.1/ns/\",\n      \"edc\": \"https://w3id.org/edc/v0.0.1/ns/\",\n      \"tx\": \"https://w3id.org/tractusx/v0.0.1/ns/\",\n      \"tx-auth\": \"https://w3id.org/tractusx/auth/\",\n      \"cx-policy\": \"https://w3id.org/catenax/policy/\",\n      \"odrl\": \"http://www.w3.org/ns/odrl/2/\"\n    }\n  }"

headers = { 'content-type': "application/json" }

conn.request("POST", "/management/v3/assets", payload, headers)

res = conn.getresponse()
data = res.read()

print(data.decode("utf-8"))

##innovalia
payload = "  {\n    \"@id\": \"asset_hmi_demo_innovalia\",\n    \"@type\": \"Asset\",\n    \"properties\": {\n      \"description\": \"MQTT Public Test\",\n      \"metadata.volume\": \"1Mb\",\n      \"id\": \"asset_hmi_demo_innovalia\"\n    },\n    \"privateProperties\": {\n      \"assetOwner\": \"innovalia\",\n      \"urn:dih-cloud:com:state\": \"active\"\n    },\n    \"dataAddress\": {\n      \"@type\": \"DataAddress\",\n      \"type\": \"Mqtt\",\n      \"keepAliveDuration\": \"PT600s\",\n      \"topic\": \"umati/v2/innovalia/democlient1/MachineToolType/nsu=urn:open62541.unconfigured.application;s=Spark_20Gage\",\n      \"mqtt.password\": \"w4IIqsEo0nna3N5V\",\n      \"mqtt.host.servers\": \"tcp://35.246.210.137:31883\",\n      \"mqtt.username\": \"umatiApp\",\n      \"id\": \"umatiApp\"\n    },\n    \"@context\": {\n      \"@vocab\": \"https://w3id.org/edc/v0.0.1/ns/\",\n      \"edc\": \"https://w3id.org/edc/v0.0.1/ns/\",\n      \"tx\": \"https://w3id.org/tractusx/v0.0.1/ns/\",\n      \"tx-auth\": \"https://w3id.org/tractusx/auth/\",\n      \"cx-policy\": \"https://w3id.org/catenax/policy/\",\n      \"odrl\": \"http://www.w3.org/ns/odrl/2/\"\n    }\n  }"

headers = { 'content-type': "application/json" }

conn.request("POST", "/management/v3/assets", payload, headers)

res = conn.getresponse()
data = res.read()

print(data.decode("utf-8"))

##cesmii
payload = "  {\n    \"@id\": \"asset_hmi_demo_cesmii\",\n    \"@type\": \"Asset\",\n    \"properties\": {\n      \"description\": \"MQTT Public Test\",\n      \"metadata.volume\": \"1Mb\",\n      \"id\": \"asset_hmi_demo_cesmii\"\n    },\n    \"privateProperties\": {\n      \"assetOwner\": \"CESMII\",\n      \"urn:dih-cloud:com:state\": \"active\"\n    },\n    \"dataAddress\": {\n      \"@type\": \"DataAddress\",\n      \"type\": \"Mqtt\",\n      \"keepAliveDuration\": \"PT600s\",\n      \"topic\": \"umati/v2/cesmii/HMI_demonstrator/MachineToolType/nsu=http:_2F_2Fcesmii.org_2FCNCBaseType_2F;i=5002\",\n      \"mqtt.password\": \"w4IIqsEo0nna3N5V\",\n      \"mqtt.host.servers\": \"tcp://35.246.210.137:31883\",\n      \"mqtt.username\": \"umatiApp\",\n      \"id\": \"umatiApp\"\n    },\n    \"@context\": {\n      \"@vocab\": \"https://w3id.org/edc/v0.0.1/ns/\",\n      \"edc\": \"https://w3id.org/edc/v0.0.1/ns/\",\n      \"tx\": \"https://w3id.org/tractusx/v0.0.1/ns/\",\n      \"tx-auth\": \"https://w3id.org/tractusx/auth/\",\n      \"cx-policy\": \"https://w3id.org/catenax/policy/\",\n      \"odrl\": \"http://www.w3.org/ns/odrl/2/\"\n    }\n  }"

headers = { 'content-type': "application/json" }

conn.request("POST", "/management/v3/assets", payload, headers)

res = conn.getresponse()
data = res.read()

print(data.decode("utf-8"))


##gizbr


payload = "  {\n    \"@id\": \"asset_hmi_demo_gizbr\",\n    \"@type\": \"Asset\",\n    \"properties\": {\n      \"description\": \"MQTT Public Test\",\n      \"metadata.volume\": \"1Mb\",\n      \"id\": \"asset_hmi_demo_gizbr\"\n    },\n    \"privateProperties\": {\n      \"assetOwner\": \"CESMII\",\n      \"urn:dih-cloud:com:state\": \"active\"\n    },\n    \"dataAddress\": {\n      \"@type\": \"DataAddress\",\n      \"type\": \"Mqtt\",\n      \"keepAliveDuration\": \"PT600s\",\n      \"topic\": \"umati/v2/gizbr/MachineToolType/+\",\n      \"mqtt.password\": \"w4IIqsEo0nna3N5V\",\n      \"mqtt.host.servers\": \"tcp://35.246.210.137:31883\",\n      \"mqtt.username\": \"umatiApp\",\n      \"id\": \"umatiApp\"\n    },\n    \"@context\": {\n      \"@vocab\": \"https://w3id.org/edc/v0.0.1/ns/\",\n      \"edc\": \"https://w3id.org/edc/v0.0.1/ns/\",\n      \"tx\": \"https://w3id.org/tractusx/v0.0.1/ns/\",\n      \"tx-auth\": \"https://w3id.org/tractusx/auth/\",\n      \"cx-policy\": \"https://w3id.org/catenax/policy/\",\n      \"odrl\": \"http://www.w3.org/ns/odrl/2/\"\n    }\n  }"

headers = { 'content-type': "application/json" }

conn.request("POST", "/management/v3/assets", payload, headers)

res = conn.getresponse()
data = res.read()

print(data.decode("utf-8"))

## fva

payload = "  {\n    \"@id\": \"asset_hmi_demo_fva\",\n    \"@type\": \"Asset\",\n    \"properties\": {\n      \"description\": \"MQTT Public Test\",\n      \"metadata.volume\": \"1Mb\",\n      \"id\": \"asset_hmi_demo_fva\"\n    },\n    \"privateProperties\": {\n      \"assetOwner\": \"FVA GmbH - interop4X\",\n      \"urn:dih-cloud:com:state\": \"active\"\n    },\n    \"dataAddress\": {\n      \"@type\": \"DataAddress\",\n      \"type\": \"Mqtt\",\n      \"keepAliveDuration\": \"PT28800s\",\n      \"topic\": \"umati/v2/fva/sebastian/GlassMachineType/nsu=urn:de.interop4X.opcua.choco_cutting_table;i=1000\",\n      \"mqtt.password\": \"w4IIqsEo0nna3N5V\",\n      \"mqtt.host.servers\": \"tcp://35.246.210.137:31883\",\n      \"mqtt.username\": \"umatiApp\",\n      \"id\": \"umatiApp\"\n    },\n    \"@context\": {\n      \"@vocab\": \"https://w3id.org/edc/v0.0.1/ns/\",\n      \"edc\": \"https://w3id.org/edc/v0.0.1/ns/\",\n      \"tx\": \"https://w3id.org/tractusx/v0.0.1/ns/\",\n      \"tx-auth\": \"https://w3id.org/tractusx/auth/\",\n      \"cx-policy\": \"https://w3id.org/catenax/policy/\",\n      \"odrl\": \"http://www.w3.org/ns/odrl/2/\"\n    }\n  }"

headers = { 'content-type': "application/json" }

conn.request("POST", "/management/v3/assets", payload, headers)

res = conn.getresponse()
data = res.read()

print(data.decode("utf-8"))

## policy
payload = "{\n  \"@context\": {\n    \"dct\": \"https://purl.org/dc/terms/\",\n    \"edc\": \"https://w3id.org/edc/v0.0.1/ns/\",\n    \"dcat\": \"https://www.w3.org/ns/dcat/\",\n    \"odrl\": \"http://www.w3.org/ns/odrl/2/\",\n    \"dspace\": \"https://w3id.org/dspace/v0.8/\"\n  },\n  \"@type\": \"edc:PolicyDefinition\",\n  \"@id\": \"all_access\",\n  \"edc:policy\": {\n    \"@id\": \"all_access\",\n    \"@type\": \"odrl:Set\",\n    \"odrl:permission\": [\n      {\n        \"odrl:action\": {\n          \"odrl:type\": \"USE\"\n        }\n      }\n    ],\n    \"odrl:prohibition\": [],\n    \"odrl:obligation\": []\n  }\n}"

headers = { 'content-type': "application/json" }

conn.request("POST", "/management/v2/policydefinitions", payload, headers)

res = conn.getresponse()
data = res.read()

print(data.decode("utf-8"))

## conctracdefinitions

payload = "{\n  \"@context\": {},\n  \"@id\": \"all_contract_definition\",\n  \"@type\": \"ContractDefinition\",\n  \"accessPolicyId\": \"all_access\",\n  \"contractPolicyId\": \"all_access\",\n  \"assetsSelector\": [\n    {\n      \"@type\": \"CriterionDto\",\n      \"operandLeft\": \"https://w3id.org/edc/v0.0.1/ns/id\",\n      \"operator\": \"like\",\n      \"operandRight\": \"%\"\n    },\n    {\n      \"@type\": \"CriterionDto\",\n      \"operandLeft\": \"urn:dih-cloud:com:state\",\n      \"operator\": \"=\",\n      \"operandRight\": \"active\"\n    }\n  ]\n}"

headers = { 'content-type': "application/json" }

conn.request("POST", "/management/v2/contractdefinitions", payload, headers)

res = conn.getresponse()
data = res.read()

print(data.decode("utf-8"))