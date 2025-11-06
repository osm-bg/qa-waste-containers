import queryOverpass from "@derhuerst/query-overpass";
import fs from "fs";

function fetch_osm_data() {
    const overpass_query = `[out:json][timeout:25];
    area(id:3600186382)->.searchArea;
    (
        node[amenity=recycling][access!=private](area.searchArea);
        node[amenity=waste_disposal][access!=private](area.searchArea);
        node[amenity=vending_machine][vending=bottle_return](area.searchArea);
    );
    out center;`;

    return queryOverpass(overpass_query);
}

function has_recycling_tags(tags, target_keys) {
    return target_keys.every(type => {
        const key = `recycling:${type}`;
        const allowed_values = ['yes', 'only'];
        return tags.hasOwnProperty(key) && allowed_values.includes(tags[key]);
    });
}

function preprocess_osm_data(data) {
    const containers = {
        mixed: [],
        package_recycling: [],
        pet_container: [],
        clothes_recycling: [],
        electronic_recycling: [],
        battery_recycling: [],
        bottle_return_machines: [],
        unknown_type: [],
        unknown_waste: []
    };
    for(const item of data) {
        item.coords = [item.lat, item.lon];
        delete item.lat;
        delete item.lon;
        if(item.tags.amenity === 'recycling' && !item.tags.recycling_type) {
            containers.unknown_type.push(item);
            continue;
        }

        if(item.tags.amenity === 'vending_machine' && item.tags.vending === 'bottle_return') {
            containers.bottle_return_machines.push(item);
        }
        else if(item.tags.amenity === 'waste_disposal') {
            containers.mixed.push(item);
        }
        else if(has_recycling_tags(item.tags, ['clothes', 'shoes'])) {
            containers.clothes_recycling.push(item);
        }
        else if(has_recycling_tags(item.tags, ['electrical_appliances'])) {
            containers.electronic_recycling.push(item);
        }
        else if(has_recycling_tags(item.tags, ['batteries'])) {
            containers.battery_recycling.push(item);
        }
        else if(has_recycling_tags(item.tags, ['plastic_packaging', 'metal_packaging', 'paper_packaging', 'glass_packaging'])) {
            containers.package_recycling.push(item);
        }
        else {
            containers.unknown_waste.push(item);
        }
    }
    return containers;
}

async function run() {
    const osm_data = await fetch_osm_data();
    const containers = preprocess_osm_data(osm_data);
    const to_write = {
        date: new Date().toISOString(),
        data: containers
    };
    fs.writeFileSync('waste-containers.json', JSON.stringify(to_write, null, 2));
}

run();