import asyncio
import time
from asyncua import Client
from basyx.aas import model
from basyx.aas.model import DictObjectStore
from basyx.aas.adapter import aasx
import basyx.aas.adapter.json
import datetime
import requests
import json
import uuid
import base64
import urllib.parse

def utf8_base64_url_encode(text):
    # Step 1: UTF-8 encode
    utf8_bytes = text.encode('utf-8')
    
    # Step 2: Base64 encode
    base64_bytes = base64.urlsafe_b64encode(utf8_bytes)
    
    # Step 3: Decode to a string for URL-safe Base64 representation
    base64_url_encoded = base64_bytes.decode('utf-8')
    
    return base64_url_encoded.rstrip('=')

# Example usage
text = "Hello, world!"
encoded_text = utf8_base64_url_encode(text)
print(encoded_text)


# Define BaSyx URLs based on the provided configuration
AAS_REGISTRY_URL = "https://aas-registry.interop4x.de/shell-descriptors"
AAS_REPOSITORY_URL = "https://aas-env.interop4x.de/shells"
SUBMODEL_REPOSITORY_URL = "https://aas-env.interop4x.de/submodels"
CONCEPT_DESCRIPTION_REPOSITORY_URL = "https://aas-env.interop4x.de/concept-descriptions"

def create_aas_for_job(job_data, job_id):
    aas_id = f"JobAAS_{job_data.JobOrder.JobOrderID}"
    #short_id = uuid.uuid4().__str__().replace("-","_")
    short_id = "job"+ str(aas_id).replace(" ","")

    print(short_id)
    
    # Erstellen des AAS-Objekts
    aas = model.AssetAdministrationShell(
        id_=model.Identifier(short_id),
        id_short=(aas_id),
        asset_information=model.AssetInformation(
            asset_kind=model.AssetKind.INSTANCE,
            global_asset_id=((aas_id))
        )
    )
    
    object_store = DictObjectStore()
    object_store.add(aas)

    submodels = []
    submodels.append(addJobManagementSubmodel(job_data, job_id, aas,object_store))
    submodels.append(addBoMSubmodel(job_data, job_id, aas,object_store))
    submodels.append(addContactSubmodel(job_data, job_id, aas,object_store))

    # Verknüpfung des Submodels zum AAS hinzufügen
    file_store = aasx.DictSupplementaryFileContainer()

    # Erstellen der individuellen AASX-Datei
    aasx_file_name = f"{aas_id}.aasx"
    with aasx.AASXWriter(aasx_file_name) as writer:
        writer.write_aas(aas_ids=[aas.id], object_store=object_store,file_store=file_store)
        
        # Metadaten hinzufügen
        meta_data = aasx.pyecma376_2.OPCCoreProperties()
        meta_data.creator = "Automatisierte AAS-Erstellung"
        meta_data.created = datetime.datetime.now()
        writer.write_core_properties(meta_data)

    print(f"AASX-Datei {aasx_file_name} wurde erfolgreich erstellt.")
    # Register AAS and Submodel in BaSyx
    register_aas_in_basyx(aas_id, aas, submodels)

def addJobManagementSubmodel(job_data, job_id, aas,object_store):
    submodel_id = f"Machinery Job Response {job_data.JobOrder.JobOrderID}"
    # Submodel für den Job erstellen
    submodel = model.Submodel(
        id_=model.Identifier(submodel_id),
        id_short="MachineryJobResponse"    )
    
    semantic_reference = model.ExternalReference(
        (model.Key(
            type_=model.KeyTypes.GLOBAL_REFERENCE,
            value='http://interop4X.deg/Properties/HasAttribute'
        ),)
    )
    #short_id = uuid.uuid4().__str__().replace("-","_")
    short_id = "s" + str(job_id)

    submodel.submodel_element.add(
        model.Property(
            id_short="JobOrderID",
            value=job_data.JobOrder.JobOrderID,
            value_type=model.datatypes.String,
            semantic_id=semantic_reference  # set the semantic reference
        )
    )
    

    # Step 3.3: add the Property to the Submodel        
    aas.submodel.add(model.ModelReference.from_referable(submodel))
    # AAS und Submodel in den ObjectStore laden
    object_store.add(submodel)
    return submodel
    # Register AAS and Submodel in BaSyx
    #register_aas_in_basyx(aas_id, aas, submodel)

def addContactSubmodel(job_data, job_id, aas,object_store):
    submodel_id = f"https://admin-shell.io/zvei/nameplate/1/0/ContactInformations"
    # Submodel für den Job erstellen
    submodel = model.Submodel(
        id_=model.Identifier(submodel_id),
        id_short="ContactInformations"
        )
    contact = model.SubmodelElementCollection(
        id_short="ContactInformation",
        #id ="https://admin-shell.io/zvei/nameplate/1/0/ContactInformations/ContactInformation"
    )
    
    phone = model.SubmodelElementCollection(
        id_short="Phone",
        #id ="https://admin-shell.io/zvei/nameplate/1/0/ContactInformations/ContactInformation"
    )
    phone.add_referable(model.Property(
        id_short="TelephoneNumber",
        #id="0173-1#02-AAO206#002",
        value="+49 151 1478 5860",
        value_type=model.datatypes.String,

    ))
    contact.add_referable(phone)
    
    mail = model.SubmodelElementCollection(
        id_short="Email",
        #id ="https://admin-shell.io/zvei/nameplate/1/0/ContactInformations/ContactInformation"
    )
    mail.add_referable(model.Property(
        id_short="EmailAddress",
        #id="0173-1#02-AAO206#002",
        value="info@interop4X.de",
        value_type=model.datatypes.String,

    ))
    contact.add_referable(mail)
    
    contact.add_referable(model.Property(
        id_short="FirstName",
        #id="0173-1#02-AAO206#002",
        value="Sebastian",
        value_type=model.datatypes.String,

    ))
    
    contact.add_referable(model.Property(
        id_short="NameOfContact",
        #id="0173-1#02-AAO205#002",
        value="Friedl",
        value_type=model.datatypes.String
    ))
    
    submodel.submodel_element.add(contact)
    
    aas.submodel.add(model.ModelReference.from_referable(submodel))
    # AAS und Submodel in den ObjectStore laden
    object_store.add(submodel)
    return submodel
    
    
def addBoMSubmodel(job_data, job_id, aas,object_store):
    submodel_id = f"https://admin-shell.io/idta/HierarchicalStructures/Template/1/1/Submodel"
    # Submodel für den Job erstellen
    submodel = model.Submodel(
        id_=model.Identifier(submodel_id),
        id_short="HierarchicalStructures",
        )
    
    semanticId_entry_node = model.ExternalReference(
        (model.Key(
            type_=model.KeyTypes.GLOBAL_REFERENCE,
            value='https://admin-shell.io/idta/HierarchicalStructures/EntryNode/1/0'
        ),)
    )
    
    semanticId_node = model.ExternalReference(
        (model.Key(
            type_=model.KeyTypes.GLOBAL_REFERENCE,
            value='https://admin-shell.io/idta/HierarchicalStructures/Node/1/0'
        ),)
    )
 

    entry = model.Entity(
            entity_type=model.EntityType.CO_MANAGED_ENTITY,
            id_short="EntryNode",
            semantic_id=semanticId_entry_node
        )
    submodel.submodel_element.add(entry)
    
    bar = create_and_add_part(submodel,entry,"Chocolate bar")
    package = create_and_add_part(submodel,bar,"packageSet")
    create_and_add_part(submodel,package,"package")
    create_and_add_part(submodel,package,"label")
    Chocolate = create_and_add_part(submodel,bar,"Chocolate")
    ingredients = [
    "Sugar",
    "CocoaButter",
    "WholeMilkPowder",
    "CocoaMass",
    "Lecithine"
    ]
    for ingredient in ingredients:
        create_and_add_part(submodel,Chocolate, ingredient)

    aas.submodel.add(model.ModelReference.from_referable(submodel))
    # AAS und Submodel in den ObjectStore laden
    object_store.add(submodel)
    return submodel

def create_and_add_part(submodel,node,name):
    HasPart = model.ExternalReference(
        (model.Key(
            type_=model.KeyTypes.GLOBAL_REFERENCE,
            value='https://admin-shell.io/idta/HierarchicalStructures/HasPart/1/0'
        ),)
    )
    semanticId_node = model.ExternalReference(
        (model.Key(
            type_=model.KeyTypes.GLOBAL_REFERENCE,
            value='https://admin-shell.io/idta/HierarchicalStructures/Node/1/0'
        ),)
    )
    tmp = name.replace(" ","")
    part = model.Entity(
            entity_type=model.EntityType.CO_MANAGED_ENTITY,
            id_short=tmp,
            semantic_id=semanticId_node
        )    
    node.add_referable(part)
    has_part_relationship = model.RelationshipElement(
        id_short=f"HasPart_{node.id_short}_{tmp}",
        first=model.ModelReference.from_referable(node),
        second=model.ModelReference.from_referable(part),
        semantic_id=HasPart
    )
    submodel.submodel_element.add(has_part_relationship)
    return part
    

def register_aas_in_basyx(aas_id, aas, submodels):

    headers = {
    "Content-Type": "application/json"
    }

    
    aashell_json_string = json.dumps(aas, cls=basyx.aas.adapter.json.AASToJsonEncoder)

    # Add AAS to AAS Repository
    print(aashell_json_string)
    res = requests.post(AAS_REPOSITORY_URL, data=aashell_json_string,headers=headers)
    print(f"AAS {aas_id} added to AAS Repository.")
    print (res)
    
    for submodel in submodels:
        submodel_json_string = json.dumps(submodel, cls=basyx.aas.adapter.json.AASToJsonEncoder)
        #print(submodel_json_string)
        tmp2_id = utf8_base64_url_encode(submodel.id)

        # Add Submodel to Submodel Repository
        submodel_endpoint = f"{SUBMODEL_REPOSITORY_URL}"
        res = requests.post(submodel_endpoint, data=submodel_json_string,headers=headers)
        print(f"Submodel {submodel.id} added to Submodel Repository.")
    #print (res)


async def main():
    # URL des OPC UA Servers
    url = "opc.tcp://localhost:48030"  # Ändere die URL entsprechend deines Servers

    # Erstellen eines Clients
    async with Client(url=url) as client:
        # Verbinde mit dem Server

        # Pfad zur JobOrderList
        node_path = [
            "0:Objects",
            "5:Machines",
            "7:ChocoCuttingTable",
            "5:MachineryBuildingBlocks",
            "3:JobManagement",
            "3:JobOrderControl",
            "2:JobOrderList"
        ]
        knowenJob  = []
        while True:
            await client.connect()
            print("Verbunden mit dem OPC UA Server")
            await client.load_data_type_definitions()
            await client.load_type_definitions()

            time.sleep(10)
            # Node über den Pfad finden
            node = await client.nodes.root.get_child(node_path)
            print("Node Found")
            # Wert der JobOrderList lesen
            job_order_list = await node.read_value()
            #print("JobOrderList:", job_order_list)
            for i, job in enumerate(job_order_list):
                if (job.State[0].StateNumber == 5):
                    if not job in knowenJob:
                        create_aas_for_job(job, i)
                        knowenJob.append(job)
            await client.disconnect()

# Event Loop starten
if __name__ == "__main__":
    asyncio.run(main())
