import asyncio
import os
from asyncua import ua, Server
from asyncua.common.instantiate_util import instantiate


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


async def import_xml_file(server, file_path, strict_mode=True):
    """
    Imports an XML file into the server.

    Args:
        server: The OPC UA server instance.
        file_path: The path to the XML file to import.
        strict_mode: Specifies whether to use strict mode during import.
    """
    try:
        await server.import_xml(file_path, strict_mode=strict_mode)
        print(f"Successfully imported {file_path}")
    except Exception as e:
        print(f"Failed to import {file_path}: {e}")
        
async def import_models(server):
    print("Importing companion spec. XML...")
    xml_files = [
        ("models/Opc.Ua.Di.NodeSet2.xml", False),
        ("models/opc.ua.isa95-jobcontrol.nodeset2.xml", False),
        ("models/Opc.Ua.Machinery.Jobs.Nodeset2.xml", False),
        ("models/Opc.Ua.Machinery.NodeSet2.xml", False),
        ("models/opc.ua.glas.v2.nodeset2.xml", False)
       ]
    

    for rel_path, strict_mode in xml_files:
        # Construct the full file path, ensuring OS compatibility
        file_path = os.path.dirname(rel_path)
        await import_xml_file(server, rel_path, strict_mode)


async def create_flat_glass_machine_instance(server):
    print("Create Scale example")
    idx = await server.register_namespace("de.interop4X.opcua.chococuttingtable")
    machinery_idx = await server.get_namespace_index('http://opcfoundation.org/UA/Machinery/')
    scale_idx = await server.get_namespace_index('http://opcfoundation.org/UA/Glass/Flat/v2/')

    machine_type_nodeid = f"ns={scale_idx};i=1015"
    machine_type_node = server.get_node(machine_type_nodeid)
    displayname = ua.LocalizedText("chococuttingtable")
    machines_node = await server.nodes.objects.get_child(f"{machinery_idx}:Machines")

    await instantiate(machines_node, machine_type_node, bname=f"{idx}:chococuttingtable", dname=displayname)
    machine_node = await server.nodes.objects.get_child([f"{machinery_idx}:Machines",f"{idx}:chococuttingtable"])
    print(machine_node)

async def main():
    # Erstelle einen OPC UA Server
    server = Server()
    await server.init()

    # Setze die URL für den Server (z.B. localhost)
    server.set_endpoint("opc.tcp://localhost:48400")
    
    # Setze den Servernamen
    server.set_server_name("interop4X - Choco Cutting Table")
    
    await import_models(server)
    
   
    await create_flat_glass_machine_instance(server)

    # Starte den Server
    async with server:
        print("OPC UA Server läuft! Drücke Strg+C zum Beenden.")
        while True:
            await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(main())
