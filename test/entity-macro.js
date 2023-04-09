import { describe, it } from "mocha";
//import assert from "power-assert";

import pluginTester from "babel-plugin-tester"
import plugin from "babel-plugin-macros"

describe("entity.macro", () => {
	it("provides syntactic sugar for our entity system", () => {

		pluginTester({
			plugin,
			pluginOptions: {
				entityMacro: { config: "test/test-macro-config.json" }
			},
			babelOptions: {filename: __filename},
			tests: [
				{
					code: `
					  import entity from '../entity.macro'
				
						entity((a,b) => {
							a.x = 0
							
							a.health = 0
							console.log(b.y,c)
							a=3
						})`,
					output:`
						const _array = entitySystem.arrays[0];
						_array[a * 5 + 1] = 0;
						_array[a * 5 + 4] = 0;
						console.log(_array[b * 5 + 2], c);
						a = 3;`
				},

				{
					code: `
					  import entity from '../entity.macro'
				
						entity(a => {
							entitySystem.forEach(0,"Health", a => a.health)
						})`,
					output: `
						const _array = entitySystem.arrays[0];
						entitySystem.forEach(0, "Health", (a) => _array[a * 5 + 4]);
					`
				},
				{
					code: `
					import entity from '../entity.macro'
					
					entity(entity => {
						entity.x = 0
					})`,
					output:`
					const _array = entitySystem.arrays[0];
					_array[entity * 5 + 1] = 0;`
				},


			],
		})

	});
});
