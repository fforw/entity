const fs = require("fs")
const path = require("path")
const t = require("@babel/types")
const { createMacro, MacroError } = require("babel-plugin-macros")
const EntitySystem = require("./src/EntitySystem")

module.exports = createMacro(entityMacro, {
    configName: "entityMacro"
})

function getConfig(entitySystem, ref)
{
    const entities = ref.parentPath.node.arguments[0].params.map(p => p.name)
    const props = new Map()

    const usedArrays = new Set()

    const VisitEntityPropReferences = {
        MemberExpression(path)
        {
            const {object, property} = path.node

            if (object.type === "Identifier" && entities.indexOf(object.name) >= 0)
            {
                if (property.type !== "Identifier")
                {
                    throw new MacroError("Only Identifier props allowed for entities.")
                }

                const cfg = entitySystem.getPropConfig(property.name, MacroError)
                props.set(
                    property.name,
                    cfg
                )

                usedArrays.add(cfg.array)
            }
        }
    }

    ref.parentPath.get("arguments.0.body").traverse(VisitEntityPropReferences)
    return {props, usedArrays, entities}
}


function entityMacro({references,config, state}) {


    const json = fs.readFileSync(
        path.join( state.file.opts.root, config && config.config ? config.config : "entity-config.json"),
        "utf-8"
    );

    const raw = JSON.parse(json)
    const entitySystem = new EntitySystem(raw)

    references.default.forEach(ref => {
        const { body } = ref.parentPath.node.arguments[0]

        const {props, usedArrays, entities} = getConfig(entitySystem, ref)

        const arrayNames = {}
        for (let array of usedArrays)
        {
            arrayNames[array] = ref.scope.generateUidIdentifier("array").name
        }

        const PrepareEntityPropReferences = {
            MemberExpression(path)
            {
                const {object, property} = path.node

                if (object.type === "Identifier" && entities.indexOf(object.name) >= 0)
                {
                    if (property.type !== "Identifier")
                    {
                        throw new MacroError("Only Identifier props allowed for entities.")
                    }

                    const { array, sizeOf, offset } = props.get(property.name)

                    let offsetExpr = t.binaryExpression(
                        "*",
                        t.identifier(object.name),
                        t.numericLiteral(sizeOf)
                    )

                    if (offset !== 0)
                    {
                        offsetExpr = t.binaryExpression(
                            "+",
                            offsetExpr,
                            t.numericLiteral(offset)
                        )
                    }

                    path.replaceWith(
                        t.memberExpression(
                            t.identifier(arrayNames[array]),
                            offsetExpr,
                            true
                        )
                    )
                }
            }
        }


        ref.parentPath.get("arguments.0.body").traverse(PrepareEntityPropReferences)

        body.body.unshift(
            t.variableDeclaration("const",

                Array.from(usedArrays, array => (
                    t.variableDeclarator(
                        t.identifier(arrayNames[array]),
                        t.memberExpression(
                            t.memberExpression(
                                t.identifier("entitySystem"),
                                t.identifier("arrays"),
                                false
                            ),
                            t.numericLiteral(array),
                            true
                        )
                    )

                ))
            )
        )
        ref.parentPath.replaceWithMultiple(body.body)
    })
}
