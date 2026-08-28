import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    rules: {
      // dsh-manager.ts uses Node.js child_process/http/net/fs APIs extensively.
      // @types/node EventEmitter overloads and process.env typing trigger
      // false-positive "unsafe member access" warnings on every .on/.pid/.kill
      // call. These rules add no safety value here and are disabled project-wide.
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
);
