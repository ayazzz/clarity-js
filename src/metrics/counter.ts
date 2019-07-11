import {ICounter, ICounterSummary} from "@clarity-types/metrics";
import {Counter} from "./enums";

let tracker: ICounter = {};
let summary: ICounterSummary = {};

export function increment(key: Counter, counter: number = 1): void {
    if (!(key in tracker)) {
        tracker[key] = { updated: true, counter };
    }
    tracker[key].updated = true;
    tracker[key].counter += counter;
}

export function summarize(): ICounterSummary {
    for (let key in tracker) {
        if (tracker[key].updated) {
            summary[key] = { counter: tracker[key].counter };
            tracker[key].updated = false;
        }
    }
    return summary;
}
