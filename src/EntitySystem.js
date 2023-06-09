const MAX_ENTITY = 1024
const EXPORT_VERSION = 1

const pkgJson = require("../package.json")

/**
 * Entity system configuration from the view point of a single prop name
 *
 * @typedef EntitySystemConfig
 * @type {object}
 *
 * @property {Object<String,Array.<String>>} Components           Object of component names mapping to a prop name array
 * @property {Array<{ components: Array.<LayoutJSON> }>} Layout   Defines the layout of components within the tables
 * @property {number} entityCount                                 Initial allocation of entities
 *
 */

/**
 * Layout for one array
 *
 * @typedef LayoutJSON
 * @type {object}
 * @property {Array.<String>} components    components to store in the array
 * @property {number} size                  Initial number of rows / entities
 *
 */

/**
 * Exported JSON object hierarchy.
 *
 * @typedef EntitySystemJSONExport
 * @type {object}
 *
 * {entities: *[], type: string, version: number}
 * @property {String} entities              clear text type string
 * @property {Number} version               export json version
 * @property {Array.<String>} entities      one object per entity containing the component props and an array prop "_"
 *                                          for tag components. 
 */

function TableState(entitySystem, tableName, sizeOf, components, combinedMask)
{
    this.entitySystem = entitySystem
    this.tableName = tableName
    this.sizeOf = sizeOf
    this.rowCounter = 0
    this.removeCounter = 0
    this.combinedMask = BigInt(combinedMask)
    this.components = components
    this.isEntityTable = !combinedMask
    this.skipOnRemove = Infinity
}

TableState.prototype.insertRow = function insertRow(at = null)
{
    const { sizeOf, entitySystem, tableName, isEntityTable } = this
    const array = entitySystem[tableName];

    let id;

    if (at !== null)
    {
         id = at
         if (at > this.rowCounter)
         {
             this.rowCounter = at + 1
         }
    }
    else if (this.removeCounter > 0)
    {
        for (let i = this.skipOnRemove; i < this.rowCounter; i++)
        {
            const offset = i * sizeOf
            const empty = isEntityTable ? (array[offset] & 1) === 0 : array[offset] < 0
            if (empty)
            {
                id = i;
                this.removeCounter--
                if (this.removeCounter === 0)
                {
                    this.skipOnRemove = Infinity
                }
                break;
            }
        }

        if (id === undefined)
        {
            throw new Error("Illegal State: could not find empty slot but removeCounter > 0")
        }
    }
    else
    {
        id = this.rowCounter++
    }

    if (id * sizeOf >= array.length)
    {
        const newSize = array.length * 2

        console.log("Growing Table '" + tableName + "' to " + newSize)

        const copy = new Float64Array(newSize)
        for (let j = 0; j < array.length; j++)
        {
            copy[j] = array[j]
        }
        entitySystem[tableName] = copy
    }
    return id;
}

TableState.prototype.removeRow = function removeRow(row)
{
    const { sizeOf, entitySystem, tableName, isEntityTable } = this
    const array  = entitySystem[tableName]

    if (isEntityTable)
    {
        array[row * sizeOf] &= ~1
    }
    else
    {
        array[row * sizeOf] = -1
    }

    this.removeCounter++
    this.skipOnRemove = Math.min(this.skipOnRemove, row)
}


const TABLE_NAMES = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"]
const TABLE_STATE_NAMES = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]

/**
 * Loads and validates the given raw JSON config
 * @param {EntitySystemConfig}} raw
 * @return {{layout: *[], components: Map<any, any>, componentsByProp: Map<any, any>}}
 */
function loadConfig(raw)
{
    let { Components, Layout, entityCount = 1024 } = raw

    if (!Layout)
    {
        Layout = [{
            components: Object.keys(Components),
            size: MAX_ENTITY
        }]
    }

    const components = new Map()
    const componentsByProp = new Map()
    for (let component in Components)
    {
        if (Components.hasOwnProperty(component))
        {
            const propNames = Components[component]

            components.set(
                component,
                {
                    name: component,
                    propNames,
                    arrayIndex: -1,
                    mask: 0n
                }
            )

            propNames.forEach(name => {

                if (typeof name !== "string" || !name.length)
                {
                    throw new Error("Invalid prop name: Must be a non-empty String")
                }

                if (name === "_" || name === "_id")
                {
                    throw new Error("Invalid prop name: _ and _id are reserved for internal purposes and cannot be used as column names")
                }

                const comp = componentsByProp.get(name)
                if (comp)
                {
                    throw Error("Config-Error: " + name + " already defined for Component " + comp)
                }
                componentsByProp.set(name, { component, name, array: -1, offset: -1, sizeOf: -1, componentMask: 0})
            })
        }
    }

    return { components, componentsByProp, layout: Layout, entityCount };
}



function removeHandler(handlers, handlerFn)
{
    const newHandlers = []
    for (let i = 0; i < handlers.length; i += 2)
    {
        const mask = handlers[i]
        const fn = handlers[i + 1]

        if (fn !== handlerFn)
        {
            newHandlers.push(mask, fn)
        }
    }
    return newHandlers
}


/**
 * Runs the matching entry handlers from the given array of callbacks and mask
 *
 * @param {Array.<function|Number>} handlers    array of callbacks and mask
 * @param {number} entity                       entity id
 * @param {BigInt} before                       bigint before mask value
 * @param {BigInt} newValue                     bigint new mask value
 */
function runEntryHandlers(handlers, entity, before, newValue)
{

    for (let i = 0; i < handlers.length; i+=2)
    {
        const m = handlers[i]
        const fn = handlers[i + 1]
        if ((newValue & m) === m && (before & m) !== m)
        {
            fn(entity, before, newValue)
        }
    }
}

/**
 * Runs the matching exit handlers from the given array of callbacks and mask
 *
 * @param {Array.<function|BigInt>} handlers    array of callbacks and mask
 * @param {number} entity                       entity id
 * @param {BigInt} before                       bigint before mask value
 * @param {BigInt} newValue                     bigint new mask value
 */
function runExitHandlers(handlers, entity, before, newValue)
{
    const bBefore= BigInt(before)
    const bNewValue = BigInt(newValue)

    for (let i = 0; i < handlers.length; i+=2)
    {
        const m = handlers[i]
        const fn = handlers[i + 1]
        if ((bNewValue & m) !== m && (bBefore & m) === m)
        {
            fn(entity, before, newValue)
        }
    }
}


/**
 * Constructs a new entity system with the given config.
 *
 * @param rawConfig
 * @constructor
 */
function EntitySystem(rawConfig)
{
    const { components, componentsByProp, layout, entityCount } = loadConfig(rawConfig)

    /**
     *
     * @type {Map<String,{propNames: Array.<String>, mask: BigInt, arrayIndex: number, name: String}>}
     */
    this.components = components
    /**
     *
     * @type {Map<String,PropConfig>}
     */
    this.componentsByProp = componentsByProp

    const arrayCount = layout.length
    this.maskSize = arrayCount

    const entityTableSizeOf = this.maskSize * 2

    // entity table. Each row is one mask value per table plus a componentOffset per component
    this.e = new Float64Array(entityTableSizeOf * entityCount);
    // table state for the entity table
    this.s = new TableState(this, "e", entityTableSizeOf, [], 0)

    // component tables
    this.c0 = null; this.c1 = null; this.c2 = null; this.c3 = null; this.c4 = null;
    this.c5 = null; this.c6 = null; this.c7 = null; this.c8 = null; this.c9 = null;
    // component table states
    this.s0 = null; this.s1 = null; this.s2 = null; this.s3 = null; this.s4 = null;
    this.s5 = null; this.s6 = null; this.s7 = null; this.s8 = null; this.s9 = null;

    this.entryHandlers = []
    this.exitHandlers = []

    for (let i = 0; i < arrayCount; i++)
    {
        const { components, size } = layout[i]

        if (components.size > 52)
        {
            throw new Error("There can be at most 52 entities per table.")
        }

        let offset = 1;
        let mask = i === 0 ?  2n : 1n

        let combined = 0n
        let propNamesForRow = []
        components.forEach( componentName => {

            const entry = this.components.get(componentName)
            const { propNames } = entry

            entry.arrayIndex = i;
            entry.mask = mask;

            for (let j = 0; j < propNames.length; j++)
            {
                const name = propNames[j]
                const cfg = componentsByProp.get(name)
                cfg.componentMask = mask
                cfg.array = i
                cfg.offset = offset++

                propNamesForRow.push(name)

                combined |= mask
            }
            mask <<= 1n
        })

        if (offset > 1)
        {
            const arrayLen = offset * size

            //console.log("Creating array #"+ arrayIndex + " for ", components.join(", "), ": sizeOf =", offset, ", size = ", size, " => ", arrayLen)

            const array = new Float64Array(arrayLen)
            const tableState = new TableState(this, TABLE_NAMES[i], offset, components, combined)
            this[TABLE_NAMES[i]] = array
            this[TABLE_STATE_NAMES[i]] = tableState
        }
    }

    for (const cfg of componentsByProp.values())
    {
        cfg.sizeOf = this[TABLE_STATE_NAMES[cfg.array]].sizeOf

    }
}


/**
 * Creates a new entity. The optional second parameter allows for convenient configuration of the new entity based on
 * a template object. All implicitly referenced components will be added to the entity and the values we set as its props
 *
 * @param {Object } [template]      Optional prop template. All implicitly referenced components will be added to
 *                                  the entity and the values we set as its props.
 *
 * @param {Number}  id              optional id suggestion.
 * @return {number} entity id
 */
EntitySystem.prototype.newEntity = function (template, id = null)
{
    const { e: entityArray, s : entityTableState } = this

    let entityId
    if (id !== null)
    {
        if (this.exists(id))
        {
            throw new Error("Entity with id = " + id + " already exists")
        }

        entityId = entityTableState.insertRow(id)
    }
    else
    {
        entityId = entityTableState.insertRow()
    }

    // mark all component offsets as having no component
    const { sizeOf } = entityTableState

    let offset = entityId * sizeOf
    // zero masks
    for (let i = 0; i < this.maskSize; i++)
    {
        entityArray[offset++] = i === 0 ? 1 : 0
    }
    // unset all offsets
    for (let i = 0; i < this.maskSize; i++)
    {
        entityArray[offset++] = -1
    }

    if (template)
    {
        this.addComponents(entityId, template)
    }
    return entityId
}

/**
 * Resolves the component name for the given prop name
 *
 * @param {String} name     prop name
 *
 * @return {String} component name
 */
EntitySystem.prototype.findComponentByProp = function(name)
{
    return this.componentsByProp.get(name).component
}

/**
 * Returns the bitmask for the given components
 * @param {String|Array.<String>} components   component name or array of components which must all belong to the same table
 * 
 * @return {BigInt} bit mask
 */
EntitySystem.prototype.mask = function(components)
{
    if (typeof components === "string")
    {
        const { mask } = this.components.get(components)
        return mask
    }
    
    let { arrayIndex, mask } = this.components.get(components[0])

    for (let i = 1; i < components.length; i++)
    {
        let { arrayIndex : idx , mask : m} = this.components.get(components[i])

        m = BigInt(m)

        if (idx !== arrayIndex)
        {
            throw new Error("mask: All given components must belong to the same table")
        }
        mask |= m
    }

    return mask
}
/**
 * Returns the property name of the entity system that stores the data for the given component
 *
 * @param {String} component    component name
 *
 * @return {String} property name
 */
EntitySystem.prototype.getTableName = function(component)
{
    return TABLE_NAMES[this.components.get(component).arrayIndex]
}

/**
 * Iterates over the entities matching the given component mask and arrayIndex
 * @param {number} arrayIndex   array index (correspond to the index of the Layout entry in the config)
 * @param {number} mask         bitMask for the components
 * @param {function} fn         callback called with the entity ids
 */
EntitySystem.prototype.forEach = function(arrayIndex, mask, fn)
{
    const bMask = BigInt(mask)

    const { e: entityArray, s: entityTableState } = this

    const { sizeOf, rowCounter } = entityTableState
    for (let i = 0; i < rowCounter; i++)
    {
        const m = BigInt(entityArray[i * sizeOf + arrayIndex])
        if ((m & bMask) === bMask)
        {
            fn(i)
        }
    }
}

let tmp = null
function tmpArray(size)
{
    if (!tmp || tmp.length < size)
    {
        tmp = new Array(size)
    }
    for (let i = 0; i < size; i++)
    {
        tmp[i] = 0n
    }
    return tmp
}


/**
 * Returns true if the given entity has all given components. The components do not need to belong to the same table.
 * 
 * @param {number} entity                       entity id
 * @param {Array.<String|BigInt>} components    Either an array of component names (that can be from different tables) or an array of component masks, one mask for each table
 *
 * @return {boolean} true if entity has all components
 */
EntitySystem.prototype.has = function(entity, components)
{
    const { e: entityArray, s: entityTableState } = this
    const entityRow = entity * entityTableState.sizeOf

    let masks
    if (typeof components[0] === "bigint")
    {
        masks = components
    }
    else
    {
        masks = tmpArray(this.maskSize)
        for (let i = 0; i < components.length; i++)
        {
            const entry = this.components.get(components[i])
            if (!entry)
            {
                throw new Error("Could not find component \"" + components[i] + "\"")
            }
            const { arrayIndex, mask } = entry
            masks[arrayIndex] |= mask
        }
    }


    for (let j = 0; j < masks.length; j++)
    {
        const m = masks[j]
        if ((BigInt(entityArray[entityRow + j]) & m) !== m)
        {
            return false
        }
    }
    return true
}

/**
 * Returns true if the given entity exists.
 *
 * @param entity        entity id
 * @return {boolean}    true if entity exists
 */
EntitySystem.prototype.exists = function exists(entity)
{
    const { e: array, s: tableState } = this;

    return !!(array[entity * tableState.sizeOf] & 1)
}

/**
 * Removes the given entity from the system.
 *
 * @param entity    entity id
 */
EntitySystem.prototype.removeEntity = function removeEntity(entity)
{
    const { e : entityArray, s : entityTableState, maskSize } = this;

    const offset = entity * entityTableState.sizeOf
    for (let i = 0; i < maskSize; i++)
    {
        const mask = BigInt(entityArray[offset + i])
        const rowOffset = entityArray[offset + maskSize + i]
        entityArray[offset + maskSize + i] = -1

        runExitHandlers(this.exitHandlers, entity, mask, 0n);

        if (rowOffset >= 0)
        {
            const array = this[TABLE_NAMES[i]]
            const ts = this[TABLE_STATE_NAMES[i]]

            array[rowOffset] = -1
            ts.removeRow(rowOffset / ts.sizeOf)
        }
    }
    entityTableState.removeRow(entity)
}

/**
 * Adds the given component to the given entity.
 *
 * @param {number} entity   entity id
 * @param {String} name     component name
 */
EntitySystem.prototype.addComponent = function addComponent(entity, name)
{
    const { e: entityArray, s: entityTableState, maskSize } = this

    const { arrayIndex, mask, propNames } = this.components.get(name)

    const entityRow = entity * entityTableState.sizeOf
    const before = BigInt(entityArray[entityRow + arrayIndex]);
    const newValue = before | mask
    entityArray[entityRow + arrayIndex] = Number(newValue)

    const array = this[TABLE_NAMES[arrayIndex]]
    const ts = this[TABLE_STATE_NAMES[arrayIndex]]

    let componentRow = entityArray[entityRow + maskSize + arrayIndex]
    if (propNames.length && componentRow < 0)
    {
        componentRow = ts.insertRow()
        entityArray[entityRow + maskSize + arrayIndex] = componentRow
        array[componentRow * ts.sizeOf] = entity
    }
    runEntryHandlers(this.entryHandlers, entity, before, newValue)
}


/**
 * Removes the given component from the given entity.
 *
 * @param {number} entity   entity id
 * @param {String|Array.<String>} name     component name or array of component names which must all be from the same array
 */
EntitySystem.prototype.removeComponent = function removeComponent(entity, name)
{
    const { arrayIndex, mask } = this.components.get(name)
    const { e: entityArray, s: entityTableState, maskSize } = this
    const entityRow = entity * entityTableState.sizeOf

    const before = BigInt(entityArray[entityRow + arrayIndex])
    const newValue = before & ~mask
    entityArray[entityRow + arrayIndex] = Number(newValue)

    runExitHandlers(this.exitHandlers, entity, before, newValue)

    const array = this[TABLE_NAMES[arrayIndex]]
    if (array)
    {
        const ts = this[TABLE_STATE_NAMES[arrayIndex]]

        if ((newValue & ts.combinedMask) === 0n)
        {
            const row = entityArray[entityRow + maskSize + arrayIndex]
            if (row >= 0)
            {
                entityArray[entityRow + maskSize + arrayIndex] = -1

                ts.removeRow(row / ts.sizeOf)
                array[row] = -1
            }
        }
    }

}

/**
 * Adds the component implied by the property names within the given template to the entity and
 * adds all the components. You can also set properties of components the entity already has.
 *
 * @param {number} entity       entity id
 * @param template              template with new properties implying new components. A property named "_" can be used to
 *                              define an array of tag components to add to the entity. "_id" properties will be ignored.
 */
EntitySystem.prototype.addComponents = function addComponents(entity, template)
{
    const { e: entityArray, s: entityTableState, maskSize } = this
    const entityRow = entity * entityTableState.sizeOf

    const masks = TABLE_NAMES.slice(0, this.maskSize).map((name, i) => BigInt(entityArray[entityRow + i]))

    const arrayRows = new Map()

    for (let name in template)
    {
        if (template.hasOwnProperty(name))
        {
            const v = template[name]

            if (name === "_")
            {
                if (Array.isArray(v))
                {
                    v.forEach(c => this.addComponent(entity, c) )
                    continue
                }
                else
                {
                    throw new Error("The special prop _ must contain an Array of component names to add to the entity")
                }
            }

            if (name === "_id")
            {
                // ignore _id in template
                continue
            }

            const { array, offset, sizeOf, componentMask } = this.getPropConfig(name)

            let componentRow = arrayRows.get(array)
            if (componentRow === undefined)
            {
                const ts = this[TABLE_STATE_NAMES[array]]

                const value = entityArray[entityRow + maskSize + array]
                if (value >= 0)
                {
                    componentRow = value / sizeOf
                }
                else
                {
                    componentRow = ts.insertRow()
                    this[TABLE_NAMES[array]][componentRow * sizeOf] = entity
                }

                arrayRows.set(array, componentRow)
            }

            const componentOffset = componentRow * sizeOf

            entityArray[entityRow + maskSize + array] = componentOffset
            
            this[TABLE_NAMES[array]][componentOffset + offset] = v
            masks[array] |= componentMask
        }
    }

    for (let j = 0; j < masks.length; j++)
    {
        const mask = masks[j]
        const before = BigInt(entityArray[entityRow + j])
        const newValue = before | mask
        entityArray[entityRow + j] = Number(newValue)

        runEntryHandlers(this.entryHandlers, entity, before, newValue)
    }
}

/**
 * Entity system configuration from the view point of a single prop name
 *
 * @typedef PropConfig
 * @type {object}
 * @property {String} component         component name the prop belongs to
 * @property {String} prop              name the of the prop
 * @property {number} array             array the prop is stored in
 * @property {number} offset            row offset of the prop
 * @property {number} sizeOf            size of the corresponding array rows
 * @property {BigInt} componentMask     component mask of the corresponding component
 */

/**
 * Returns the prop config for the given prop name.
 *
 * @param {String} name     prop name
 * @param {function} [ex]   error constructor to use when the component does not exist (internal use)
 *
 * @return {PropConfig} prop config
 */
EntitySystem.prototype.getPropConfig = function getPropConfig(name, ex = Error.prototype.constructor)
{
    const result = this.componentsByProp.get(name)
    if (!result)
    {
        throw new ex("Prop '" + name + "' is not in any of the registered components")
    }
    return result
}

/**
 * Returns an array of mask values for the given component names. The array will contain one BigInt value
 * per existing layout table.
 *
 * @param {Array.<string>} components   component names
 *
 * @return {Array.<BigInt>} masks for the given components, one per existing layout table
 */
EntitySystem.prototype.masks = function masks(components)
{
    const { maskSize } = this

    const masksArray = new Array(maskSize)
    for (let i = 0; i < maskSize; i++)
    {
        masksArray[i] = 0n
    }

    for (let i = 0; i < components.length; i++)
    {
        const component = components[i]
        const entry = this.components.get(component)
        if (!entry)
        {
            throw new Error("Could not find component \"" + component + "\"")
        }
        masksArray[entry.arrayIndex] |= entry.mask
    }

    return masksArray
}


/**
 * Reads a single entity value without using the macro.
 *
 * Note that this is indeed slower than using the macro since the macro moves most of it to compile time.
 *
 * @param {number} entity   entity id
 * @param {String} name     prop name
 *
 * @return {number} entity value
 */
EntitySystem.prototype.getValue = function getValue(entity, name)
{
    const { array, offset } = this.getPropConfig(name)
    const { e: entityArray, s: entityTableState, maskSize } = this

    const entityRow = entity * entityTableState.sizeOf
    const componentOffset = entityArray[ entityRow + maskSize + array]

    return this[TABLE_NAMES[array]][componentOffset + offset];
}

/**
 * Sets a single entity value without using the macro
 *
 * Note that this is indeed slower than using the macro since the macro moves most of it to compile time.
 * 
 * @param {number} entity   entity id
 * @param {String} name     prop name
 * @param {number} value    value to set
 */
EntitySystem.prototype.setValue = function setValue(entity, name, value)
{
    const { array, offset } = this.getPropConfig(name)
    const { e: entityArray, s: entityTableState, maskSize } = this

    const entityRow = entity * entityTableState.sizeOf
    const componentOffset = entityArray[ entityRow + maskSize + array]

    this[TABLE_NAMES[array]][componentOffset + offset] = value
}

/**
 * Registers a callback that gets called whenever an entity enters the combination of components given.
 * The last component missing being added triggers the event.
 *
 * @param {Number|BigInt} mask      component mask
 * @param {function} fn             callback
 *
 * @return {function} cleanup function to remove the callback
 */
EntitySystem.prototype.onEnter = function onEnter(mask, fn)
{
    this.entryHandlers.push(BigInt(mask), fn)
    return () => {
        this.entryHandlers = removeHandler(this.entryHandlers, fn)
    }

}

/**
 * Registers a callback that gets called whenever an entity exits the combination of components given.
 * The first component being removed triggers the event.
 *
 * @param {Number|BigInt} mask      component mask
 * @param {function} fn             callback
 *
 * @return {function} cleanup function to remove the callback
 */
EntitySystem.prototype.onExit = function onExit(mask, fn)
{
    this.exitHandlers.push(BigInt(mask), fn)
    return () => {
        this.exitHandlers = removeHandler(this.exitHandlers, fn)
    }
}

/**
 * Returns an JSON object export for the current state of the entity system.
 *
 * @param {Array.<BigInt>} [masks]   array of BigInt masks to filter to export. Must be one value per table.
 *
 * @return {EntitySystemJSONExport} JSON object hierarchy
 */
EntitySystem.prototype.toJSON = function toJSON(masks)
{
    const { e: entityArray, s: entityTableState, maskSize } = this

    const entities = []

    const { rowCounter, sizeOf } = entityTableState;

    if (sizeOf !== maskSize * 2)
    {
        throw new Error("Illegal State: sizeOf of entity table must be twice the mask size")
    }
    
    for (let i = 0; i < rowCounter; i++)
    {
        let entity = { _id: i }

        const rowOffset = i * sizeOf
        if (this.exists(i))
        {
            let containsData = false;

            let tags = []
            for (let cfg of this.components.values())
            {
                const { name, propNames, mask : componentMask, arrayIndex } = cfg

                if (!propNames.length)
                {
                    const currMask = BigInt(entityArray[rowOffset + arrayIndex])
                    if ( (!masks || (masks[arrayIndex] & componentMask) === componentMask) && (currMask & componentMask) === componentMask)
                    {
                        tags.push(name)
                    }
                }
            }

            if (tags.length)
            {
                entity._ = tags
                containsData = true
            }

            for (let cfg of this.componentsByProp.values())
            {
                const { componentMask, name, offset, array } = cfg;

                const currMask = BigInt(entityArray[rowOffset + array])
                if ( (!masks || (masks[array] & componentMask) === componentMask) && (currMask & componentMask) === componentMask)
                {
                    const columnRow = entityArray[maskSize + rowOffset + array]
                    if (columnRow >= 0)
                    {
                        entity[name] = this[TABLE_NAMES[array]][columnRow + offset]
                        containsData = true
                    }
                }
            }

            if (containsData)
            {
                entities.push(entity)
            }
        }
    }

    return {
        type : "Entity Export (" + pkgJson.name + "@" + pkgJson.version + ")",
        version : EXPORT_VERSION,
        entities
    }             
}

/**
 * Creates a new entity system from the given JSON object graph
 *
 * @param {EntitySystemConfig} config   config
 * @param {Object} json                 JSON object graph
 *
 * @return {EntitySystem} entity system containing the entities
 */
EntitySystem.fromJSON = function fromJSON(config, json)
{
    const sys = new EntitySystem(config)

    const entities = json.entities.slice()

    // sort entities so the highest entity ids come first. This way we grow only once if we need to.
    entities.sort((a,b) => b._id - a._id)

    for (let i = 0; i < entities.length; i++)
    {
        const template = entities[i]
        sys.newEntity(template, template._id)
    }

    const { e: entityArray, s: entityTableState } = sys

    const { sizeOf } = entityTableState

    // set removeCounter to the number of non-existing entities created by gaps in the imported entity ids
    let removeCounter = 0
    for (let i = 0; i < entityArray.length; i += sizeOf)
    {
        const exists = !!(entityArray[i] & 1)
        if (!exists)
        {
            removeCounter++;
        }
    }
    entityTableState.removeCounter = removeCounter

    return sys
}

// EntitySystem.TABLE_NAMES = TABLE_NAMES
// EntitySystem.TABLE_STATE_NAMES = TABLE_STATE_NAMES

module.exports = EntitySystem
