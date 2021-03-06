import { IAttributes, IElementLayoutState, ILayoutRectangle, ILayoutStyle, INodeInfo } from "@clarity-types/layout";
import { config } from "@src/config";
import { getBoundingClientRect, mask } from "@src/utils";
import { createGenericLayoutState, Tags } from "./generic";

enum Styles {
    Color = "color",
    BackgroundColor = "backgroundColor",
    BackgroundImage = "backgroundImage",
    OverflowX = "overflowX",
    OverflowY = "overflowY",
    Visibility = "visibility"
}

let defaultColor: string;
let attributeMaskList: string[];

const DefaultAttributeMaskList = ["value", "placeholder", "alt", "title"];

export function createElementLayoutState(element: Element, info: INodeInfo): IElementLayoutState {
    let tagName = element.tagName;
    let elementState = createGenericLayoutState(element, tagName) as IElementLayoutState;
    if (tagName === Tags.Script || tagName === Tags.Meta) {
        elementState.tag = Tags.Ignore;
        return elementState;
    }

    // Get attributes for the element
    elementState.attributes = getAttributes(element, info);

    // Get layout bounding box for the element
    elementState.layout = getLayout(element);

    // Get computed systems for the element with valid layout
    elementState.style = elementState.layout ? getStyles(element) : null;

    // Check if scroll is possible
    if (elementState.layout && elementState.style && (Styles.OverflowX in elementState.style || Styles.OverflowX in elementState.style)) {
        elementState.layout.scrollX = Math.round(element.scrollLeft);
        elementState.layout.scrollY = Math.round(element.scrollTop);
    }

    // Certain elements might contain 'value' field, which means different things for different types of elements,
    // but is ultimately important for each of them, so we must capture it as well. It is expected to be a string.
    // https://www.w3schools.com/tags/att_value.asp (+ HTMLTextAreaElement)
    if ("value" in element && typeof (element as any).value === "string") {
        elementState.value = getElementValue(element, info);
    }

    return elementState;
}

export function resetElementStateProvider(): void {
    attributeMaskList = DefaultAttributeMaskList.concat(config.sensitiveAttributes);
    defaultColor = "";
}

export function getAttributeValue(element: Element, info: INodeInfo, attrName: string): string {
    const sensitiveAttribute = attributeMaskList.indexOf(attrName) > -1;
    const maskAttribute = sensitiveAttribute && !info.unmask;
    const attrValue = element.attributes[attrName].value;
    return maskAttribute ? mask(attrValue) : attrValue;
}

export function getElementValue(element: Element, info: INodeInfo): string {
    const valueStr = (element as any).value;
    return info.unmask ? valueStr : mask(valueStr);
}

function getLayout(element: Element): ILayoutRectangle {
    let layout: ILayoutRectangle = null;
    const rect = getBoundingClientRect(element);
    const doc = document.documentElement;
    if (rect) {
        // getBoundingClientRect returns relative positioning to viewport and therefore needs
        // addition of window scroll position to get position relative to document
        // Also: using Math.floor() instead of Math.round() below because in Edge,
        // getBoundingClientRect returns partial pixel values (e.g. 162.5px) and Chrome already
        // floors the value (e.g. 162px). Keeping behavior consistent across
        layout = {
            x: Math.floor(rect.left) + ("pageXOffset" in window ? window.pageXOffset : doc.scrollLeft),
            y: Math.floor(rect.top) + ("pageYOffset" in window ? window.pageYOffset : doc.scrollTop),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        };
    }
    return layout;
}

function getAttributes(element: Element, info: INodeInfo): IAttributes {
    let elementAttributes = element.attributes;
    let stateAttributes: IAttributes = {};

    for (let i = 0; i < elementAttributes.length; i++) {
        let attrName = elementAttributes[i].name;
        stateAttributes[attrName] = getAttributeValue(element, info, attrName);
    }

    return stateAttributes;
}

function getStyles(element: Element): ILayoutStyle {
    let computed = window.getComputedStyle(element);
    let style = {};

    if (defaultColor.length === 0) {
        defaultColor = computed[Styles.Color];
    }

    // Send computed styles, if relevant, back to server
    if (match(computed[Styles.Visibility], ["hidden", "collapse"])) {
        style[Styles.Visibility] = computed[Styles.Visibility];
    }

    if (match(computed[Styles.OverflowX], ["auto", "scroll", "hidden"])) {
        style[Styles.OverflowX] = computed[Styles.OverflowX];
    }

    if (match(computed[Styles.OverflowY], ["auto", "scroll", "hidden"])) {
        style[Styles.OverflowY] = computed[Styles.OverflowY];
    }

    if (computed[Styles.BackgroundImage] !== "none") {
        style[Styles.BackgroundImage] = computed[Styles.BackgroundImage];
    }

    if (!match(computed[Styles.BackgroundColor], ["rgba(0, 0, 0, 0)", "transparent"])) {
        style[Styles.BackgroundColor] = computed[Styles.BackgroundColor];
    }

    if (computed[Styles.Color] !== defaultColor) {
        style[Styles.Color] = computed[Styles.Color];
    }

    return Object.keys(style).length > 0 ? style : null;
}

function match(variable: string, values: string[]): boolean {
    return values.indexOf(variable) > -1;
}
