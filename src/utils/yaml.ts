import yaml from "js-yaml";
import matter from "gray-matter";

const options = {
  engines: {
    yaml: {
      parse: (input: string) => yaml.load(input) as object,
      stringify: (data: object) => {
        return yaml.dump(data, {
          styles: { "!!null": "empty" },
        });
      },
    },
  },
};

export function readMatter(content: string) {
  return matter(content, options);
}
