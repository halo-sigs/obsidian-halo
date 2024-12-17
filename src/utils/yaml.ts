import matter from "gray-matter";
import yaml from "js-yaml";

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
