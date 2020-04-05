import { Priority } from "@clarity-types/core";
import { Constant, NodeChange, NodeInfo, NodeValue, Source } from "@clarity-types/layout";
import config from "@src/core/config";
import { schedule } from "@src/core/task";
import time from "@src/core/time";
import discover from "@src/layout/discover";
import selector from "@src/layout/selector";

let index: number = 1;
const BLACKLIST_TYPES = ["password", "hidden", "email"];
const BLACKLIST_NAMES = ["address", "cell", "code", "dob", "email", "mobile", "name", "phone", "secret", "social", "ssn", "tel", "zip"];

let nodes: Node[] = [];
let values: NodeValue[] = [];
let changes: NodeChange[][] = [];
let updateMap: number[] = [];
let selectorMap: number[] = [];

// The WeakMap object is a collection of key/value pairs in which the keys are weakly referenced
let idMap: WeakMap<Node, number> = null;
let regionMap: WeakMap<Node, string> = null;

let regionTracker: { [name: string]: number } = {};
let urlMap: { [url: string]: number } = {};

export function start(): void {
    reset();
    extractRegions(document);
    discoverTree(document);
}

export function end(): void {
    reset();
}

function reset(): void {
    index = 1;
    nodes = [];
    values = [];
    updateMap = [];
    changes = [];
    selectorMap = [];
    urlMap = {};
    idMap = new WeakMap();
    regionMap = new WeakMap();
    if (Constant.DEVTOOLS_HOOK in window) { window[Constant.DEVTOOLS_HOOK] = { get, getNode, history }; }
}

export function extractRegions(root: ParentNode): void {
    for (let key in config.regions) {
        // We check for regions in the beginning (document) and later whenever there are new additions or modifications to DOM (mutations)
        // Since mutations may happen on leaf nodes too, e.g. textnodes, which may not support all selector APIs.
        // We ensure that the root note supports querySelectorAll API before executing the code below to identify new regions.
        if (config.regions[key] && "querySelectorAll" in root) {
            let elements = root.querySelectorAll(config.regions[key]);
            let length = elements.length;
            for (let i = 0; i < length; i++) {
                if (!(key in regionTracker)) { regionTracker[key] = 0; }
                regionTracker[key]++;
                regionMap.set(elements[i], length > 1 ? `${key}.${regionTracker[key]}` : key);
            }
        }
    }
}

function discoverTree(root: Node): void {
    schedule(discover.bind(this, root), Priority.High);
}

export function getId(node: Node, autogen: boolean = false): number {
    if (node === null) { return null; }
    let id = idMap.get(node);
    if (!id && autogen) {
        id = index++;
        idMap.set(node, id);
    }

    return id ? id : null;
}

export function add(node: Node, parent: Node, data: NodeInfo, source: Source): void {
    let id = getId(node, true);
    let element = node as HTMLElement;
    let parentId = parent ? getId(parent) : null;
    let nextId = getNextId(node);
    let masked = true;
    let parentValue = null;
    let region = regionMap.has(node) ? regionMap.get(node) : null;

    if (parentId >= 0 && values[parentId]) {
        parentValue = values[parentId];
        parentValue.children.push(id);
        region = region === null ? parentValue.region : region;
        masked = parentValue.metadata.masked;
    }

    // If element has a valid shadowRoot, track Shadow DOM as a top level root node.
    if ("shadowRoot" in element && element.shadowRoot && !has(element.shadowRoot)) { discoverTree(element.shadowRoot); }

    // Check to see if this particular node should be masked or not
    masked = mask(data, masked);

    // If there's an explicit CLARITY_REGION_ATTRIBUTE set on the element, use it to mark a region on the page
    if (data.attributes && Constant.CLARITY_REGION_ATTRIBUTE in data.attributes) {
        regionMap.set(node, data.attributes[Constant.CLARITY_REGION_ATTRIBUTE]);
    }

    nodes[id] = node;
    values[id] = {
        id,
        parent: parentId,
        next: nextId,
        children: [],
        position: null,
        data,
        selector: "",
        region,
        metadata: { active: true, boxmodel: false, masked }
    };
    updateSelector(values[id]);
    metadata(data.tag, id, parentId);
    track(id, source);
}

export function update(node: Node, parent: Node, data: NodeInfo, source: Source): void {
    let id = getId(node);
    let element = node as HTMLElement;
    let parentId = parent ? getId(parent) : null;
    let nextId = getNextId(node);
    let changed = false;

    if (id in values) {
        let value = values[id];
        value.metadata.active = true;

        // Handle case where internal ordering may have changed
        if (value["next"] !== nextId) {
            changed = true;
            value["next"] = nextId;
        }

        // Handle case where parent might have been updated
        if (value["parent"] !== parentId) {
            changed = true;
            let oldParentId = value["parent"];
            value["parent"] = parentId;
            // Move this node to the right location under new parent
            if (parentId !== null && parentId >= 0) {
                if (nextId !== null && nextId >= 0) {
                    values[parentId].children.splice(nextId + 1, 0 , id);
                } else {
                    values[parentId].children.push(id);
                }
                // Update region after the move
                value.region = regionMap.has(node) ? regionMap.get(node) : values[parentId].region;
            } else {
                // Mark this element as deleted if the parent has been updated to null
                remove(id, source);
            }

            // Remove reference to this node from the old parent
            if (oldParentId !== null && oldParentId >= 0) {
                let nodeIndex = values[oldParentId].children.indexOf(id);
                if (nodeIndex >= 0) {
                    values[oldParentId].children.splice(nodeIndex, 1);
                }
            }
        }

        // If element has a valid shadowRoot, track Shadow DOM as a top level root node.
        if ("shadowRoot" in element && element.shadowRoot && !has(element.shadowRoot)) { discoverTree(element.shadowRoot); }

        // Update data
        for (let key in data) {
            if (diff(value["data"], data, key)) {
                changed = true;
                value["data"][key] = data[key];
            }
        }

        // Update selector
        updateSelector(value);
        metadata(data.tag, id, parentId);
        track(id, source, changed);
    }
}

function mask(data: NodeInfo, masked: boolean): boolean {
    let attributes = data.attributes;
    let tag = data.tag.toUpperCase();

    // Do not proceed if attributes are missing for the node
    if (attributes === null || attributes === undefined) { return masked; }

    // Check for blacklist fields (e.g. address, phone, etc.) only if the input node is not already masked
    if (masked === false && tag === Constant.TAG_INPUT && Constant.NAME_ATTRIBUTE in attributes) {
        let value = attributes[Constant.NAME_ATTRIBUTE].toLowerCase();
        for (let name of BLACKLIST_NAMES) {
            if (value.indexOf(name) >= 0) {
                masked = true;
                continue;
            }
        }
    }

    // Check for blacklist types (e.g. password, email, etc.) and set the masked property appropriately
    if (Constant.TYPE_ATTRIBUTE in attributes && BLACKLIST_TYPES.indexOf(attributes[Constant.TYPE_ATTRIBUTE]) >= 0) { masked = true; }

    // Following two conditions superseede any of the above. If there are explicit instructions to mask / unmask a field, we honor that.
    if (Constant.MASK_ATTRIBUTE in attributes) { masked = true; }
    if (Constant.UNMASK_ATTRIBUTE in attributes) { masked = false; }

    return masked;
}

function diff(a: NodeInfo, b: NodeInfo, field: string): boolean {
    if (typeof a[field] === "object" && typeof b[field] === "object") {
        for (let key in a[field]) { if (a[field][key] !== b[field][key]) { return true; } }
        for (let key in b[field]) { if (b[field][key] !== a[field][key]) { return true; } }
        return false;
    }
    return a[field] !== b[field];
}

function position(parent: NodeValue, child: NodeValue): number {
    let tag = child.data.tag;
    let hasClassName = child.data.attributes && !(Constant.CLASS_ATTRIBUTE in child.data.attributes);
    // Find relative position of the element to generate :nth-of-type selector
    // We restrict relative positioning to two cases:
    //   a) For specific whitelist of tags
    //   b) And, for remaining tags, only if they don't have a valid class name
    if (parent && ((tag === "DIV" || tag === "TR" || tag === "P" || tag === "LI" || tag === "UL") || hasClassName)) {
        child.position = 1;
        let idx = parent ? parent.children.indexOf(child.id) : -1;
        while (idx-- > 0) {
            let sibling = values[parent.children[idx]];
            if (child.data.tag === sibling.data.tag) { child.position = sibling.position + 1; }
            break;
        }
    }
    return child.position;
}

function updateSelector(value: NodeValue): void {
    let parent = value.parent && value.parent in values ? values[value.parent] : null;
    let prefix = parent ? `${parent.selector}>` : null;
    let ex = value.selector;
    let current = selector(value.data.tag, prefix, value.data.attributes, position(parent, value));
    if (current !== ex && selectorMap.indexOf(value.id) === -1) { selectorMap.push(value.id); }
    value.selector = current;
}

export function getNode(id: number): Node {
    if (id in nodes) {
        return nodes[id];
    }
    return null;
}

export function getMatch(url: string): Node {
    if (url in urlMap) {
        return getNode(urlMap[url]);
    }
    return null;
}

export function getValue(id: number): NodeValue {
    if (id in values) {
        return values[id];
    }
    return null;
}

export function get(node: Node): NodeValue {
    let id = getId(node);
    return id in values ? values[id] : null;
}

export function has(node: Node): boolean {
    return getId(node) in nodes;
}

export function boxmodel(): NodeValue[] {
    let v = [];
    for (let id in values) {
        if (values[id].metadata.active && values[id].metadata.boxmodel) {
            v.push(values[id]);
        }
    }
    return v;
}

export function updates(): NodeValue[] {
    let output = [];
    for (let id of updateMap) {
        if (id in values) {
            let v = values[id];
            let p = v.parent;
            let hasId = "attributes" in v.data && Constant.ID_ATTRIBUTE in v.data.attributes;
            v.data.path = p === null || p in updateMap || hasId || v.selector.length === 0 ? null : values[p].selector;
            output.push(values[id]);
        }
    }
    updateMap = [];
    return output;
}

function remove(id: number, source: Source): void {
    let value = values[id];
    value.metadata.active = false;
    value.parent = null;
    track(id, source);
    for (let child of value.children) { remove(child, source); }
    value.children = [];
}

function metadata(tag: string, id: number, parentId: number): void {
    if (id !== null && parentId !== null) {
        let value = values[id];
        let attributes = "attributes" in value.data ? value.data.attributes : {};
        switch (tag) {
            case "VIDEO":
            case "AUDIO":
            case "LINK":
                // Track mapping between URL and corresponding nodes
                if (Constant.HREF_ATTRIBUTE in attributes && attributes[Constant.HREF_ATTRIBUTE].length > 0) {
                    urlMap[getFullUrl(attributes[Constant.HREF_ATTRIBUTE])] = id;
                }
                if (Constant.SRC_ATTRIBUTE in attributes && attributes[Constant.SRC_ATTRIBUTE].length > 0) {
                    if (attributes[Constant.SRC_ATTRIBUTE].indexOf(Constant.DATA_PREFIX) !== 0) {
                        urlMap[getFullUrl(attributes[Constant.SRC_ATTRIBUTE])] = id;
                    }
                }
                if (Constant.SRCSET_ATTRIBUTE in attributes && attributes[Constant.SRCSET_ATTRIBUTE].length > 0) {
                    let srcset = attributes[Constant.SRCSET_ATTRIBUTE];
                    let urls = srcset.split(",");
                    for (let u of urls) {
                        let parts = u.trim().split(" ");
                        if (parts.length === 2 && parts[0].length > 0) {
                            urlMap[getFullUrl(parts[0])] = id;
                        }
                    }
                }
                break;
            case "IFRAME":
                if (config.lean === false) { value.metadata.boxmodel = true; }
                break;
        }

        // Enable boxmodel if this node defines a new region
        // This setting is not recurrsive and does not apply to any of the children.
        // It tells Clarity to monitor bounding rectangle (x,y,width,height) for this region.
        // E.g. region would be "SearchBox" and what's inside that region (input field, submit button, label, etc.) do not matter.
        if (regionMap.has(nodes[id])) { value.metadata.boxmodel = true; }
    }
}

function getFullUrl(relative: string): string {
    let a = document.createElement("a");
    a.href = relative;
    return a.href;
}

function getNextId(node: Node): number {
    let id = null;
    while (id === null && node.nextSibling) {
        id = getId(node.nextSibling);
        node = node.nextSibling;
    }
    return id;
}

function copy(input: NodeValue[]): NodeValue[] {
    return JSON.parse(JSON.stringify(input));
}

function track(id: number, source: Source, changed: boolean = true): void {
    // Keep track of the order in which mutations happened, they may not be sequential
    // Edge case: If an element is added later on, and pre-discovered element is moved as a child.
    // In that case, we need to reorder the prediscovered element in the update list to keep visualization consistent.
    let uIndex = updateMap.indexOf(id);
    if (uIndex >= 0 && source === Source.ChildListAdd) {
        updateMap.splice(uIndex, 1);
        updateMap.push(id);
    } else if (uIndex === -1 && changed) { updateMap.push(id); }

    if (Constant.DEVTOOLS_HOOK in window) {
        let value = copy([values[id]])[0];
        let change = { time: time(), source, value };
        if (!(id in changes)) { changes[id] = []; }
        changes[id].push(change);
    }
}

function history(id: number): NodeChange[] {
    if (id in changes) {
        return changes[id];
    }
    return [];
}
