import { describe, it } from "mocha";
import assert from "power-assert";
import fs from "fs"
import path from "path"

import EntitySystem from "../src/EntitySystem"
import $entity from "../entity.macro"
import sinon from "sinon"


const testConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "test-macro-config.json"), "utf-8"))

describe("Entity System", () => {
	it("creates entities from templates", () => {
		const system = new EntitySystem({
				"Components": {
					"Appearance": ["x", "y", "z"],
					"Health": ["health"],
					"Tag": [],
				},

				"Layout": [
					{
						"components": ["Appearance", "Health", "Tag"],
						"size": 10
					}
				]
			}
		)

		const dummy = system.newEntity({
			_ : ["Tag"],
			x: 1, y: 2, z: 3,
			health: 4
		})

		assert(system.e[0] === 15)	// "exists" bit + 3 components
		assert(system.e[1] === 0)
		assert(system.e[2] === 0)

		const id = system.newEntity({
			x: 10, y: 20, z: 30,
			health: 100
		})

		const entityRow = id * system.s.sizeOf

		assert(id === 1)
		assert(system.has(id, ["Appearance"]) === true)
		assert(system.has(id, ["Health"]) === true)
		assert(system.has(id, ["Appearance", "Health"]) === true)
		assert(system.has(id, ["Tag"]) === false)

		assert(system.s.sizeOf === 2)	// 1 mask + 1 offset
		assert(system.e[entityRow    ] === 7)	// "exists" bit + first two components
		assert(system.e[entityRow + 1] === 5)

		const componentRow = 5

		assert(system.c0[componentRow    ] === id)
		assert(system.c0[componentRow + 1] === 10)
		assert(system.c0[componentRow + 2] === 20)
		assert(system.c0[componentRow + 3] === 30)
		assert(system.c0[componentRow + 4] === 100)

		const id2 = system.newEntity({
			health: 100
		})
		assert(system.has(id2, ["Health"]) === true)
		assert(system.has(id2, ["Appearance"]) === false)
	})

	it("adds and removes components from entities", () => {
		const system = new EntitySystem({
				"Components": {
					"Appearance": ["x", "y", "z"],
					"Health": ["health"],
					"Tag": [],
				},

				"Layout": [
					{
						"components": ["Appearance", "Health"],
						"size": 1024
					},
					{
						"components": ["Tag"],
						"size": 256
					}
				]
			}
		)

		const dummy = system.newEntity({
			x: 1, y: 2, z: 3,
			health: 4
		})
		assert(system.e[0] === 7) // "exists" + Appearance + Health
		assert(system.e[2] === 0)

		const id = system.newEntity({
			x: 10, y: 20, z: 30,
			health: 100
		})

		const idRow = id * system.s.sizeOf

		const columnRow = 5

		assert(system.e[idRow    ] === 7) // "exists" + Appearance + Health
		assert(system.e[idRow + 1] === 0) 
		assert(system.e[idRow + 2] === columnRow)
		assert(system.s0.rowCounter === 2)
		assert(system.c0[columnRow    ] === id)
		assert(system.c0[columnRow + 1] === 10)
		assert(system.c0[columnRow + 2] === 20)
		assert(system.c0[columnRow + 3] === 30)
		assert(system.c0[columnRow + 4] === 100)

		system.removeComponent(id, "Health")
		assert(system.has(id, ["Health"]) === false)
		assert(system.e[idRow    ] === 3) // "exists" + Appearance
		assert(system.e[idRow + 2] === columnRow)
		assert(system.c0[columnRow] === id)
		assert(system.c0[columnRow + 4] === 100) // unchanged
		assert(system.s0.removeCounter === 0)

		system.addComponents(id, { health: 200 })
		assert(system.e[idRow] === 7) // "exists" + Appearance + Health
		assert(system.e[idRow + 2] === columnRow)
		assert(system.c0[columnRow] === id)
		assert(system.c0[columnRow + 4] === 200)

		system.removeComponent(id, "Appearance")
 		assert(system.e[idRow] === 5) // "exists" + Health
		assert(system.e[idRow + 2] === columnRow)
		assert(system.s0.removeCounter === 0)
		system.removeComponent(id, "Health")
		assert(system.e[idRow    ] === 1) // "exists"
		assert(system.e[idRow + 2] === -1)
		assert(system.s0.removeCounter === 1)

		system.addComponents(id, { x: 20, y: 30, z: 40 })
		assert(system.e[idRow    ] === 3) // "exists" + Appearance
		assert(system.e[idRow + 2] === columnRow) // recycled
		assert(system.e[idRow + 3] === -1)
		assert(system.s0.removeCounter === 0)

		system.addComponent(id, "Tag")
		assert(system.has(id, ["Tag"]) === true)
		assert(system.e[idRow    ] === 3) // "exists" + Appearance
		assert(system.e[idRow + 1] === 1) // Tag
		system.removeComponent(id, "Tag")
		assert(system.e[idRow    ] === 3) // "exists" + Appearance
		assert(system.e[idRow + 1] === 0) // ---
		assert(system.has(id, ["Tag"]) === false)
	})

	it("finds entities with components", () => {

		const system = new EntitySystem({
				"Components" : {
					"Appearance" : [ "x", "y", "z"],
					"Health" : [ "health" ],
					"Tag" : [],
				},

				"Layout" : [
					{
						"components": ["Appearance", "Health", "Tag"],
						"size" : 1024
					}
				]
			}
		)

		const id = system.newEntity({
			x: 10, y: 20, z: 30,
			health: 100
		})

		const id2 = system.newEntity({
			health: 100
		})

		const findMask = system.mask(["Appearance", "Health"])
		const findMask2 = system.mask(["Health"])
		{
			const spy = sinon.spy()
			system.forEach(0, findMask, spy)
			assert(spy.callCount === 1)
			assert(spy.getCall(0).args[0] === id);
		}
		{
			const spy = sinon.spy()
			system.forEach(0, findMask2, spy)
			assert(spy.callCount === 2)
			assert(spy.getCall(0).args[0] === id);
			assert(spy.getCall(1).args[0] === id2);
		}
	});

	it("removes entities", () => {
        const system = new EntitySystem({
            "Components": {
                "Appearance": ["x", "y", "z"],
                "Health": ["health"],
            },

            "Layout": [
                {
                    "components": ["Appearance", "Health"],
                    "size": 1024
                }
            ]
        })
        const id = system.newEntity({
            health: 100
        })
        const id2 = system.newEntity({
            health: 100
        })

        assert(system.exists(id))
        assert(system.exists(id2))

        system.removeEntity(id)

        assert(!system.exists(id))
        const id3 = system.newEntity({
            health: 100
        })


        assert(system.exists(id3))
		// recycled id
        assert(id === id3)

    })


	it("works together with the entity macro", () => {

		// for the entity macro test, we actually set the system-wide config to a test-config. To actually run the code
		// in the test it is easiest to keep using the project wide config and adjust this test
		const system = new EntitySystem(testConfig)

		let id = system.newEntity({
			x: 10, y: 20, z: 30,
			health: 100
		})
		const id2 = system.newEntity({
			x: 10, y: 20, z: 30,
			health: 75
		})
		const id3 = system.newEntity({
			x: 10, y: 20, z: 30,
			health: 66
		})

		assert( id + 1 === id2)

		const orig = id;
		// the $entity block is just a AST-marker to define a code-block and the entity variables we want magically enhanced
		// the block and the import for it are removed. The id inside the arrow function *is* the same as outside, i.e.
		// a number. Only the member access magic of the macro enables this to work. 
		$entity((id,orig) => {

			id.y = 50
			id.health = 50

			assert(id.y === 50)
			assert(id.health === 50)


			// id++ is actually the numerically next entity
			id++
			assert(id.y === 20)
			assert(id.health === 75)

			// assignment works, too
			id = id3
			assert(id.y === 20)
			assert(id.health === 66)

			// original id entity not changes to id variable
			assert(orig.y === 50)
			assert(orig.health === 50)

		})

		assert(system.e[0] === 7) // "exists" + Appearance + Health
		assert(system.e[1] === 0)
		assert(system.c0[0] === orig)
		assert(system.c0[2] === 50)
		assert(system.c0[4] === 50)

	})

	it("gets and sets entity prop values without macro", () => {
		// for the entity macro test, we actually set the system-wide config to a test-config. To actually run the code
		// in the test it is easiest to keep using the project wide config and adjust this test
		const system = new EntitySystem(testConfig)

		const id = system.newEntity({
			health: 100
		})
		const id2 = system.newEntity({
			health: 100
		})

		// $entity((id,id2) => {
		// 	assert(id.health === 100)
		// 	assert(id2.health === 100)
		// })

		assert(system.getValue(id, "health") === 100)
		assert(system.getValue(id2, "health") === 100)

		system.setValue(id, "health",200)

		assert(system.getValue(id, "health") === 200)
		// $entity(id => {
		// 	assert(id.health === 200)
		// })
	});

	it("tracks components entering and exiting component combinations", () => {

		const system = new EntitySystem(testConfig)

		const enterHealthSpy = sinon.spy()
		const cleanup = system.onEnter(system.mask("Health"), enterHealthSpy)

		{
			const id = system.newEntity({
				health: 100
			})
			const id2 = system.newEntity({
				health: 100
			})
			const id3 = system.newEntity({
				x: 100
			})

			assert(enterHealthSpy.callCount === 2)
			assert(enterHealthSpy.getCall(0).args[0] === id)
			assert(enterHealthSpy.getCall(1).args[0] === id2)
		}

		//console.log(enterHealthSpy.getCalls().map(c => c.args))


		const enterAppearanceAndHealthSpy = sinon.spy()
		const exitAppearanceAndHealthSpy = sinon.spy()
		const cleanup2 = system.onEnter(system.mask(["Appearance", "Health"]), enterAppearanceAndHealthSpy)
		const cleanup3 = system.onExit(system.mask(["Appearance", "Health"]), exitAppearanceAndHealthSpy)

		{
			const id = system.newEntity({
				x: 100,
				health: 100
			})
			const id2 = system.newEntity({
				x: 100
			})
			const id3 = system.newEntity()
			system.addComponent(id3, "Appearance")
			system.addComponent(id3, "Health")

			assert(enterAppearanceAndHealthSpy.callCount === 2)
			assert(enterAppearanceAndHealthSpy.getCall(0).args[0] === id)
			assert(enterAppearanceAndHealthSpy.getCall(1).args[0] === id3)

			system.removeComponent(id, "Appearance")

			system.removeComponent(id3, "Appearance")
			system.removeComponent(id3, "Health")

			system.removeComponent(id, "Health")	// triggers callback for id
			system.removeComponent(id2, "Appearance") // no callback called. id2 was never in both states.

			assert(exitAppearanceAndHealthSpy.callCount === 2)
			assert(exitAppearanceAndHealthSpy.getCall(0).args[0] === id)
			assert(exitAppearanceAndHealthSpy.getCall(1).args[0] === id3)
		}

		assert(system.entryHandlers.length === 4)
		assert(system.exitHandlers.length === 2)

		cleanup()
		cleanup2()
		cleanup3()

		assert(system.entryHandlers.length === 0)
		assert(system.exitHandlers.length === 0)

	})

	it("supports 53 bit masks", () => {

		const system = new EntitySystem({
				"Components": {
					"Appearance": ["x", "y", "z"],
					"Health": ["health"],
					"Tag0": [],
					"Tag1": [],
					"Tag2": [],
					"Tag3": [],
					"Tag4": [],
					"Tag5": [],
					"Tag6": [],
					"Tag7": [],
					"Tag8": [],
					"Tag9": [],
					"Tag10": [],
					"Tag11": [],
					"Tag12": [],
					"Tag13": [],
					"Tag14": [],
					"Tag15": [],
					"Tag16": [],
					"Tag17": [],
					"Tag18": [],
					"Tag19": [],
					"Tag20": [],
					"Tag21": [],
					"Tag22": [],
					"Tag23": [],
					"Tag24": [],
					"Tag25": [],
					"Tag26": [],
					"Tag27": [],
					"Tag28": [],
					"Tag29": [],
					"Tag30": [],
					"Tag31": [],
					"Tag32": [],
					"Tag33": [],
					"Tag34": [],
					"Tag35": [],
					"Tag36": [],
					"Tag37": [],
					"Tag38": [],
					"Tag39": [],
					"Tag40": [],
					"Tag41": [],
					"Tag42": [],
					"Tag43": [],
					"Tag44": [],
					"Tag45": [],
					"Tag46": [],
					"Tag47": [],
					"Tag48": [],
					"Tag49": [],
				}
			}
		)

		const mask = system.mask(["Tag49"])
		const enterSpy = sinon.spy()
		const exitSpy = sinon.spy()
		system.onEnter(mask, enterSpy)
		system.onExit(mask, exitSpy)

		const entity = system.newEntity()
		assert(system.exists(entity))
		assert(system.e[0] === 1)


		system.addComponent(entity, "Tag49")

		assert( system.has(entity, ["Tag49"]))
		assert(system.e[0] === Math.pow(2,52) + 1)
		system.removeComponent(entity, "Tag49")
		assert( !system.has(entity, ["Tag49"]))

		assert(enterSpy.callCount === 1)
		assert(exitSpy.callCount === 1)

	})

	it("exports its state as JSON object graph", () => {

		const config = {
			"Components": {
				"Appearance": ["x", "y", "z"],
				"Health": ["health"],
				"Tag": [],
			}
		}
		let system = new EntitySystem(config)

		const dummy = system.newEntity({
			_ : ["Tag"],
			x: 1, y: 2, z: 3,
			health: 4
		})

		const id = system.newEntity({
			x: 10, y: 20, z: 30,
			health: 100
		})

		const json = system.toJSON()
		assert.deepEqual(json, {
				"type": json.type,
				"version": 1,
				"entities": [
					{
						"_id": 0,
						"_": ["Tag"],
						"x": 1,
						"y": 2,
						"z": 3,
						"health": 4
					},
					{
						"_id": 1,
						"x": 10,
						"y": 20,
						"z": 30,
						"health": 100
					}
				]
			}
		)

		system = EntitySystem.fromJSON(config, json)

		const e0 = 0
		const e1 = 1

		assert( system.has(e0, ["Tag"]))

		$entity((e0,e1) => {

			assert(e0.x === 1)
			assert(e0.y === 2)
			assert(e0.z === 3)
			assert(e0.health === 4)

			assert(e1.x === 10)
			assert(e1.y === 20)
			assert(e1.z === 30)
			assert(e1.health === 100)

		})

	})

});
