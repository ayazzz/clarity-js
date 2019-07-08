import deserialize from "./data/deserialize";
import serialize from "./data/serialize";
import discover from "./dom/discover";
import mutation from "./dom/mutation";

window["SERIALIZE"] = serialize;
window["DESERIALIZE"] = deserialize;

/* Initial discovery of DOM */
export function init(): void {
  mutation();
  discover().then(() => {
    // DEBUG: Remove later
    console.log("done discovery!");
    console.log(window["TRACKER"][0]["duration"] + "ms in " + window["TRACKER"][0]["count"] + " iterations");
    // DEBUG: Serialize DOM
    serialize().then((output: string) => {
      console.log("Serialized DOM: " + output);
      console.log("Serialized DOM Length: " + output.length);
      console.log("done serialization!");
      console.log(window["TRACKER"][3]["duration"] + "ms in " + window["TRACKER"][3]["count"] + " iterations");
      console.log("====================");
      let deserialized = deserialize(output);
      console.log("Deserialized DOM: " + deserialized);
      console.log("Deserialized DOM Length: " + deserialized.length);
    });
  });
}
