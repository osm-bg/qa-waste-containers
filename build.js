import queryOverpass from "@derhuerst/query-overpass";
import fs from "fs";

const CONTAINER_MAX_MATCH_DISTANCE_METERS = 15;

function fetch_osm_data() {
    console.log("Fetching data from Overpass API...");
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

function has_recycling_tags(tags, target_keys, all_must_exist = true) {
    function accepts(type) {
        const key = `recycling:${type}`;
        const allowed_values = ['yes', 'only'];
        return tags.hasOwnProperty(key) && allowed_values.includes(tags[key]);
    }
    if(all_must_exist) {
        return target_keys.every(type => accepts(type));
    }
    return target_keys.some(type => accepts(type));
}

function preprocess_osm_data(data) {
    console.log("Preprocessing OSM data...");
    for(const item of data) {
        item.coords = [item.lat, item.lon];
        delete item.lat;
        delete item.lon;
        if(item.tags.amenity === 'recycling' && !item.tags.recycling_type) {
            item.cat = 'unknown_type';
            continue;
        }

        if(item.tags.amenity === 'vending_machine' && item.tags.vending === 'bottle_return') {
            item.cat = 'bottle_return_machine';
        }
        else if(item.tags.amenity === 'waste_disposal') {
            item.cat = 'waste_disposal';
        }
        else if(has_recycling_tags(item.tags, ['clothes', 'shoes'], false)) {
            item.cat = 'clothes_recycling';
        }
        else if(has_recycling_tags(item.tags, ['electrical_appliances'])) {
            item.cat = 'electronic_recycling';
        }
        else if(has_recycling_tags(item.tags, ['batteries'])) {
            item.cat = 'battery_recycling';
        }
        else if(has_recycling_tags(item.tags, ['plastic_packaging', 'metal_packaging', 'paper_packaging', 'glass_bottles'], false)) {
            item.cat = 'package_recycling';
        }
        else if(has_recycling_tags(item.tags, ['pet_drink_bottles'])) {
            item.cat = 'pet_container';
        }
        else if(has_recycling_tags(item.tags, ['cooking_oil'])) {
            item.cat = 'cooking_oil';
        }
        else if(has_recycling_tags(item.tags, ['plastic_bottle_caps'])) {
            item.cat = 'plastic_caps';
        }
        else if(has_recycling_tags(item.tags, ['drugs'])) {
            item.cat = 'drugs';
        }
        else {
            item.cat = 'unknown_waste';
        }
    }
    console.log(`Done. Processed ${data.length} items.`);
}

function in_bbox(coords, bbox) {
    return bbox.min_lat <= coords[0] && coords[0] <= bbox.max_lat &&
           bbox.min_lon <= coords[1] && coords[1] <= bbox.max_lon;
}

function find_points_in_bbox(points, group, threshold_meters) {
    const meter_to_deg_simple = 0.0000089; // Approximation: 1 meter ~ 0.0000089 degrees
    const threshold_deg = threshold_meters * meter_to_deg_simple;
    const bbox = {
        min_lat: Math.min(...group.map(p => p.coords[0])) - threshold_deg,
        max_lat: Math.max(...group.map(p => p.coords[0])) + threshold_deg,
        min_lon: Math.min(...group.map(p => p.coords[1])) - threshold_deg,
        max_lon: Math.max(...group.map(p => p.coords[1])) + threshold_deg,
    };
    return points.filter(p => !p.visited && in_bbox(p.coords, bbox));
}

function group_close_points(points, threshold_meters) {
    console.log("Grouping close points...");
    const groups = [];
    while(true) {
        const group = {
            containers: [points.find(p => !p.visited)]
        }
        if(!group.containers[0]) break; // No unvisited points left
        group.containers[0].visited = true;
        let prev_group_size = 0;
        let curr_group_size = group.containers.length;
        while(prev_group_size !== curr_group_size) {
            group.containers.push(...find_points_in_bbox(points, group.containers, threshold_meters));
            let waste_disposal_count = group.containers.filter(p => p.cat === 'waste_disposal').length;
            if(waste_disposal_count > 1) {
                for(let i = group.containers.length - 1; i >= 0; i--) {
                    // Remove excess 'waste_disposal' containers, keep only one
                    if(group.containers[i].cat === 'waste_disposal' && waste_disposal_count > 1) {
                        group.containers.splice(i, 1);
                        waste_disposal_count--;
                    }
                }
            }
            prev_group_size = curr_group_size;
            curr_group_size = group.containers.length;
            for(const p of group.containers) {
                if(!p.visited) {
                    p.visited = true;
                }
            }
        }
        group.containers.sort((a, b) => a.coords[0] - b.coords[0] || a.coords[1] - b.coords[1]);
        groups.push(group);
        if(group.containers.length > 2) {
            console.log(`Formed group ${groups.length} with ${group.containers.length} points.`);
            console.log(group.containers.map(p => p.id));
        }
    }
    for(const p of points) {
        delete p.visited;
    }
    console.log(`Done. Formed ${groups.length} groups.`);
    return groups;
}

async function run() {
    const osm_data = await fetch_osm_data();
    preprocess_osm_data(osm_data);
    const grouped_data = group_close_points(osm_data, CONTAINER_MAX_MATCH_DISTANCE_METERS);
    const to_write = {
        date: new Date().toISOString(),
        data: grouped_data
    };
    fs.writeFileSync('waste-containers.json', JSON.stringify(to_write, null, 2));
}

run();