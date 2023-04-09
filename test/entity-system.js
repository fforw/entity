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
		const entitySystem = new EntitySystem({
				"Components": {
					"Appearance": ["x", "y", "z"],
					"Health": ["health"],
					"Tag": [],
				},

				"Layout": [
					{
						"components": ["Appearance", "Health", "Tag"],
						"size": 1024
					}
				]
			}
		)

		const id = entitySystem.newEntity({
			x: 10, y: 20, z: 30,
			health: 100
		})

		assert(id === 0)
		assert(entitySystem.has(id, ["Appearance"]) === true)
		assert(entitySystem.has(id, ["Health"]) === true)
		assert(entitySystem.has(id, ["Appearance", "Health"]) === true)
		assert(entitySystem.has(id, ["Tag"]) === false)

		assert(entitySystem.arrays[0][0] === 7)
		assert(entitySystem.arrays[0][1] === 10)
		assert(entitySystem.arrays[0][2] === 20)
		assert(entitySystem.arrays[0][3] === 30)
		assert(entitySystem.arrays[0][4] === 100)

		const id2 = entitySystem.newEntity({
			health: 100
		})
		assert(entitySystem.has(id2, ["Health"]) === true)
		assert(entitySystem.has(id2, ["Appearance"]) === false)
	})

	it("adds and removes components from entities", () => {
		const entitySystem = new EntitySystem({
				"Components": {
					"Appearance": ["x", "y", "z"],
					"Health": ["health"],
					"Tag": [],
				},

				"Layout": [
					{
						"components": ["Appearance", "Health", "Tag"],
						"size": 1024
					}
				]
			}
		)

		const id = entitySystem.newEntity({
			x: 10, y: 20, z: 30,
			health: 100
		})

		entitySystem.removeComponent(id, "Health")
		assert(entitySystem.has(id, ["Health"]) === false)
		assert(entitySystem.arrays[0][0] === 3)

		entitySystem.addComponents(id, { health: 200 })
		assert(entitySystem.arrays[0][0] === 7)
		assert(entitySystem.arrays[0][4] === 200)

		entitySystem.addComponent(id, "Tag")
		assert(entitySystem.has(id, ["Tag"]) === true)
		assert(entitySystem.arrays[0][0] === 15)
		entitySystem.removeComponent(id, "Tag")
		assert(entitySystem.has(id, ["Tag"]) === false)
	})


	it("adds and removes components from entities", () => {
		const entitySystem = new EntitySystem({
				"Components": {
					"Appearance": ["x", "y", "z"],
					"Health": ["health"],
					"Tag": [],
				},

				"Layout": [
					{
						"components": ["Appearance", "Health", "Tag"],
						"size": 1024
					}
				]
			}
		)

	});

	it("finds entities with components", () => {

		const entitySystem = new EntitySystem({
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
		const id = entitySystem.newEntity({
			x: 10, y: 20, z: 30,
			health: 100
		})

		const id2 = entitySystem.newEntity({
			health: 100
		})

		const spy = sinon.spy()
		entitySystem.forEach(0, 3, spy)
		assert(spy.callCount === 1)
		assert(spy.getCall(0).args[0] === 0);
	});

	it("removes entities", () => {
        const entitySystem = new EntitySystem({
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
        const id = entitySystem.newEntity({
            health: 100
        })
        const id2 = entitySystem.newEntity({
            health: 100
        })

        assert(entitySystem.exists(id))
        assert(entitySystem.exists(id2))

        entitySystem.removeEntity(id)

        assert(!entitySystem.exists(id))
        const id3 = entitySystem.newEntity({
            health: 100
        })


        assert(entitySystem.exists(id3))
		// recycled id
        assert(id === id3)

    })


	it("works together with the entity macro", () => {

		// for the entity macro test, we actually set the system-wide config to a test-config. To actually run the code
		// in the test it is easiest to keep using the project wide config and adjust this test
		const entitySystem = new EntitySystem(testConfig)

		let id = entitySystem.newEntity({
			x: 10, y: 20, z: 30,
			health: 100
		})
		const id2 = entitySystem.newEntity({
			x: 10, y: 20, z: 30,
			health: 75
		})
		const id3 = entitySystem.newEntity({
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

			// XXX: note that normal access to the entity variable itself works just as before.

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
		assert(entitySystem.arrays[0][2] === 50)
		assert(entitySystem.arrays[0][4] === 50)

	})

	it("gets and sets entity prop values without macro", () => {
		// for the entity macro test, we actually set the system-wide config to a test-config. To actually run the code
		// in the test it is easiest to keep using the project wide config and adjust this test
		const entitySystem = new EntitySystem(testConfig)

		const id = entitySystem.newEntity({
			health: 100
		})
		const id2 = entitySystem.newEntity({
			health: 100
		})

		$entity((id,id2) => {
			assert(id.health === 100)
			assert(id2.health === 100)
		})

		assert(entitySystem.getValue(id, "health") === 100)
		assert(entitySystem.getValue(id2, "health") === 100)

		entitySystem.setValue(id, "health",200)

		assert(entitySystem.getValue(id, "health") === 200)
		$entity(id => {
			assert(id.health === 200)
		})
	});

	it("tracks components entering and exiting", () => {

		const entitySystem = new EntitySystem(testConfig)

		const enterHealthSpy = sinon.spy()
		const cleanup = entitySystem.onEnter(entitySystem.mask("Health"), enterHealthSpy)

		{
			const id = entitySystem.newEntity({
				health: 100
			})
			const id2 = entitySystem.newEntity({
				health: 100
			})
			const id3 = entitySystem.newEntity({
				x: 100
			})

			assert(enterHealthSpy.callCount === 2)
			assert(enterHealthSpy.getCall(0).args[0] === id)
			assert(enterHealthSpy.getCall(1).args[0] === id2)
		}

		//console.log(enterHealthSpy.getCalls().map(c => c.args))


		const enterAppearanceAndHealthSpy = sinon.spy()
		const exitAppearanceAndHealthSpy = sinon.spy()
		const cleanup2 = entitySystem.onEnter(entitySystem.mask(["Appearance", "Health"]), enterAppearanceAndHealthSpy)
		const cleanup3 = entitySystem.onExit(entitySystem.mask(["Appearance", "Health"]), exitAppearanceAndHealthSpy)

		{
			const id = entitySystem.newEntity({
				x: 100,
				health: 100
			})
			const id2 = entitySystem.newEntity({
				x: 100
			})
			const id3 = entitySystem.newEntity()
			entitySystem.addComponent(id3, ["Appearance", "Health"])

			assert(enterAppearanceAndHealthSpy.callCount === 2)
			assert(enterAppearanceAndHealthSpy.getCall(0).args[0] === id)
			assert(enterAppearanceAndHealthSpy.getCall(1).args[0] === id3)

			entitySystem.removeComponent(id, ["Appearance", "Health"])

			entitySystem.removeComponent(id3, ["Appearance"])
			entitySystem.removeComponent(id3, ["Health"])

			entitySystem.removeComponent(id2, ["Appearance", "Health"])

			assert(exitAppearanceAndHealthSpy.callCount === 3)
		}

		assert(entitySystem.entryHandlers.length === 4)
		assert(entitySystem.exitHandlers.length === 2)

		cleanup()
		cleanup2()
		cleanup3()

		assert(entitySystem.entryHandlers.length === 0)
		assert(entitySystem.exitHandlers.length === 0)

	})

});
