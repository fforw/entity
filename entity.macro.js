const fs = require("fs")
const path = require("path")
const t = require("@babel/types")
const generate = require("@babel/generator")
const { createMacro, MacroError } = require("babel-plugin-macros")
const EntitySystem = require("./src/EntitySystem")

module.exports = createMacro(entityMacro, {
    configName: "entityMacro"
})


function getKey(variable, arrayIndex)
{
    return variable + "/" + arrayIndex
}


function getConfig(entitySystem, ref)
{
    const entities = ref.parentPath.node.arguments[0].params.map(p => p.name)
    const props = new Map()

    const usedRows = new Map()
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
                const k = getKey(object.name, cfg.array)

                props.set(
                    getKey(object.name,property.name),
                    cfg
                )

                if (!usedRows.has(k))
                {
                    usedRows.set(k, {
                        key: k,
                        arrayIndex: cfg.array,
                        entity: object.name,
                        component: cfg.component,
                        sizeOf: cfg.sizeOf
                    })
                }

                usedArrays.add(cfg.array)
            }
        }
    }

    ref.parentPath.get("arguments.0.body").traverse(VisitEntityPropReferences)
    return {props, usedRows, usedArrays, entities}
}


function entityMacro({references,config, state}) {


    const json = fs.readFileSync(
        path.join( state.file.opts.root, config && config.config ? config.config : "entity-config.json"),
        "utf-8"
    );

    const raw = JSON.parse(json)
    const entitySystem = new EntitySystem(raw)

    const { maskSize } = entitySystem

    references.default.forEach(ref => {
        const { body } = ref.parentPath.node.arguments[0]

        const { props, usedRows, usedArrays, entities } = getConfig(entitySystem, ref)

        const varNames = {}
        for (let key of usedRows.keys())
        {
            const { entity, arrayIndex } = usedRows.get(key)
            varNames[key] = ref.scope.generateUidIdentifier( entity + "_T" + arrayIndex + "_" ).name
        }

        for (let arrayIndex of usedArrays)
        {
            varNames[arrayIndex] = ref.scope.generateUidIdentifier("array").name
        }


        const ReplaceEntityPropReferences = {
            "AssignmentExpression|UpdateExpression|AssignmentExpression" : function (path)
            {

                const assignmentTarget = path.node.left || path.node.argument
                if (t.isIdentifier(assignmentTarget) && entities.indexOf(assignmentTarget.name) >= 0)
                {
                    const rowsForEntity = Array.from(usedRows.values())
                        .filter(ur => ur.entity === assignmentTarget.name)
                        .reverse()

                    rowsForEntity.forEach(
                        r => path.insertAfter(
                            t.assignmentExpression(
                                "=",
                                t.identifier(varNames[r.key]),
                                t.memberExpression(
                                    t.memberExpression(
                                        t.identifier("entitySystem"),
                                        t.identifier("e"),
                                        false
                                    ),
                                    t.binaryExpression(
                                        "+",
                                        t.binaryExpression(
                                            "*",
                                            t.identifier(r.entity),
                                            t.numericLiteral(entitySystem.s.sizeOf)
                                        ),
                                        t.numericLiteral(maskSize + r.arrayIndex),
                                    ),
                                    true
                                )
                            )
                        ))
                }
            },
            MemberExpression(path)
            {
                const {object, property} = path.node

                if (object.type === "Identifier" && entities.indexOf(object.name) >= 0)
                {
                    if (property.type !== "Identifier")
                    {
                        throw new MacroError("Only Identifier props allowed for entities.")
                    }

                    const { array, sizeOf, offset } = props.get(getKey(object.name,property.name))

                    path.replaceWith(
                        t.memberExpression(
                            t.identifier(varNames[array]),
                            t.binaryExpression(
                                "+",
                                t.identifier(varNames[getKey(object.name, array)]),
                                t.numericLiteral(offset)
                            ),
                            true
                        )
                    )
                }
            }
        }


        ref.parentPath.get("arguments.0.body").traverse(ReplaceEntityPropReferences)

        body.body.unshift(
            t.variableDeclaration("let",

                [
                    ... Array.from(usedRows.keys(), key => {

                        const { arrayIndex, entity, sizeOf }= usedRows.get(key)

                        return (
                            t.variableDeclarator(
                                t.identifier(varNames[key]),
                                t.memberExpression(
                                    t.memberExpression(
                                        t.identifier("entitySystem"),
                                        t.identifier("e"),
                                        false
                                    ),
                                    t.binaryExpression(
                                        "+",
                                        t.binaryExpression(
                                            "*",
                                            t.identifier(entity),
                                            t.numericLiteral(entitySystem.s.sizeOf)
                                        ),
                                        t.numericLiteral(maskSize + arrayIndex),
                                    ),
                                    true
                                )
                            )
                        )
                    }),

                    ... Array.from(usedArrays, arrayIndex => {

                        return (
                            t.variableDeclarator(
                                t.identifier(varNames[arrayIndex]),
                                t.memberExpression(
                                    t.identifier("entitySystem"),
                                    t.identifier("c" + arrayIndex),
                                    false
                                )
                            )
                        )
                    })
                ]
            )
        )
        ref.parentPath.replaceWithMultiple(body.body)

        if (config.debug)
        {
            console.log("ENTITY MACRO RESULT", generate.default(body).code)
        }
    })
}
