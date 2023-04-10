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

							a++

							console.log(b.y,c)
							a=3
						})`,
					output:`
						let _a_T0_ = entitySystem.e[a * 2 + 1],
						  _b_T0_ = entitySystem.e[b * 2 + 1],
						  _array = entitySystem.c0;
						_array[_a_T0_ + 1] = 0;
						_array[_a_T0_ + 4] = 0;
						a++;
						_a_T0_ = entitySystem.e[a * 2 + 1];
						console.log(_array[_b_T0_ + 2], c);
						a = 3;
						_a_T0_ = entitySystem.e[a * 2 + 1];`
				},

				{
					code: `
					  import entity from '../entity.macro'
				
						entity(a => {
							entitySystem.forEach(0,"Health", a => a.health)
						})`,
					output: `
						let _a_T0_ = entitySystem.e[a * 2 + 1],
						  _array = entitySystem.c0;
						entitySystem.forEach(0, "Health", (a) => _array[_a_T0_ + 4]);`
				},
				{
					code: `
						import entity from '../entity.macro'
						
						entity(entity => {
							entity.x = 0
						})`,
					output:`
						let _entity_T0_ = entitySystem.e[entity * 2 + 1],
						  _array = entitySystem.c0;
						_array[_entity_T0_ + 1] = 0;`
				},
			],
		})
	});
});
