const MAX_ENTITY = 1024

/**
 * Entity system configuration from the view point of a single prop name
 *
 * @typedef EntitySystemConfig
 * @type {object}
 *
 * @property {Object<String,Array.<String>>} Components             Object of component names mapping to a prop name array
 * @property {Array<{ components: Array.<LayoutJSON> }>} Layout   Initial number of rows / entities
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
 * Loads and validates the given raw JSON config
 * @param {EntitySystemConfig}} raw
 * @return {{layout: *[], components: Map<any, any>, componentsByProp: Map<any, any>}}
 */
function loadConfig(raw)
{
    let { Components, Layout } = raw

    const components = new Map()
    const componentsByProp = new Map()
    for (let component in Components)
    {
        if (Components.hasOwnProperty(component))
        {
            const propNames = Components[component]

            components.set(component, { propNames, arrayIndex: -1, mask: 0 })

            propNames.forEach(name => {
                const comp = componentsByProp.get(name)
                if (comp)
                {
                    throw Error("Config-Error: " + name + " already defined for Component " + comp)
                }
                componentsByProp.set(name, { component, array: -1, offset: -1, sizeOf: -1, componentMask: 0})
            })
        }
    }

    if (!Layout)
    {
        Layout = []
        for (const name of componentsByProp.keys())
        {
            Layout.push({
                components: [name],
                size: MAX_ENTITY
            })
        }
    }

    return { components, componentsByProp, layout: Layout };
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

function runExitHandlers(handlers, entity, before, newValue)
{
    for (let i = 0; i < handlers.length; i+=2)
    {
        const m = handlers[i]
        const fn = handlers[i + 1]
        if ((newValue & m) === 0 && (before & m) !== 0)
        {
            fn(entity, before, newValue)
        }
    }
}

function getSameTableMask(entitySystem, name, op)
{
    const components = Array.isArray(name) ? name : [name]

    let { arrayIndex, mask } = entitySystem.components.get(components[0])
    for (let i = 1; i < components.length; i++)
    {
        const cfg = entitySystem.components.get(components[i])
        if (arrayIndex !== cfg.arrayIndex)
        {
            throw new Error(op + ": All components must have the same array")
        }
        mask |= cfg.mask
    }

    return [ arrayIndex, mask ]
}


/**
 * Constructs a new entity system with the given config.
 *
 * @param rawConfig
 * @constructor
 */
function EntitySystem(rawConfig)
{
    const { components, componentsByProp, layout } = loadConfig(rawConfig)

    /**
     *
     * @type {Map<String,{propNames: Array.<String>, mask: number, arrayIndex: number}>}
     */
    this.components = components
    /**
     *
     * @type {Map<String,{component:String, array: number, offset: number, sizeOf: number, componentMask: number}>}
     */
    this.componentsByProp = componentsByProp
    this.arrays = []
    this.sizeOfs = []

    this.entityCounter = 0
    this.removeCounter = 0

    this.entryHandlers = []
    this.exitHandlers = []

    for (let i = 0; i < layout.length; i++)
    {
        const { components, size } = layout[i]

        if (components.length > 52)
        {
            throw new Error("Config-Error: Layout #" + i + "has more than the possible maximum of 52 components.")
        }

        const arrayIndex = this.arrays.length

        let offset = arrayIndex === 0 ? 1 : 0;
        let mask = 2
        components.forEach( componentName => {
            const entry = this.components.get(componentName)
            const { propNames } = entry

            entry.arrayIndex = arrayIndex;
            entry.mask = mask;

            for (let j = 0; j < propNames.length; j++)
            {
                const name = propNames[j]
                const cfg = componentsByProp.get(name)
                cfg.componentMask = mask
                cfg.array = arrayIndex
                cfg.offset = offset++
            }
            mask <<= 1
        })

        const arrayLen = offset * size

        //console.log("Creating array #"+ arrayIndex + " for ", components.join(", "), ": sizeOf =", offset, ", size = ", size, " => ", arrayLen)

        this.arrays.push(
            new Float64Array(arrayLen)
        )
        this.sizeOfs.push(
            offset
        )
        for (const cfg of componentsByProp.values())
        {
            cfg.sizeOf = this.sizeOfs[cfg.array]
        }
    }
}


/**
 * Creates a new entity. The optional second parameter allows for convenient configuration of the new entity based on
 * a template object. All implicitly referenced components will be added to the entity and the values we set as its props
 *
 * @param {Object } [template]      Optional prop template. All implicitly referenced components will be added to
 *                                  the entity and the values we set as its props
 *
 * @return {number} entity id
 */
EntitySystem.prototype.newEntity = function (template)
{
    let id = -1;
    if (this.removeCounter > 0)
    {
        const a0 = this.arrays[0]
        for (let i = 0; i < this.entityCounter; i++)
        {
            const mask = a0[i]

            if ((mask & 1) === 0)
            {
                id = i;
                this.removeCounter--
                break;
            }
        }
        
        if (id === -1)
        {
            throw new Error("Illegal State: could not find empty slot but removeCounter > 0")
        }
    }
    else
    {
        id = this.entityCounter++
    }

    for (let i = 0; i < this.arrays.length; i++)
    {
        const array = this.arrays[i]

        if (id * this.sizeOfs[i] >= array.length)
        {
            const newSize = array.length * 2

            console.log("Growing Array #" + i + " to " + newSize)

            const copy = new Float64Array(newSize)
            for (let j = 0; j < array.length; j++)
            {
                copy[j] = array[j]
            }
            this.arrays[i] = copy
        }
    }

    if (template)
    {
        this.addComponents(id, template, true)
    }

    return id
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
 * @return {number} bit mask
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
        const { arrayIndex : idx , mask : m} = this.components.get(components[i])

        if (idx !== arrayIndex)
        {
            throw new Error("mask: All given components must belong to the same table")
        }
        mask |= m
    }

    return mask;
}
/**
 * Returns the array index for the given component. It corresponds to the index of the given Component within the Layout.
 *
 * @param {String} component    component name
 *
 * @return {number} array index
 */
EntitySystem.prototype.getArrayIndex = function(component)
{
    return this.components.get(component).arrayIndex
}

/**
 * Iterates over the entities matching the given component mask and arrayIndex
 * @param {number} array    array index (correspond to the index of the Layout entry in the config)
 * @param {number} mask     bitMask for the components
 * @param {function} fn
 */
EntitySystem.prototype.forEach = function(array, mask, fn)
{
    const a = this.arrays[array]
    const sizeOf = this.sizeOfs[array]
    for (let i = 0; i < a.length; i += sizeOf)
    {
        const m = a[i]
        if ((m & mask) === mask)
        {
            fn(i)
        }
    }
}

/**
 * Returns true if the given entity has all given components. The components do not need to belong to the same table.
 * @param {number} entity               entity id
 * @param {Array.<String>} components   component names
 *
 * @return {boolean} true if entity has all components
 */
EntitySystem.prototype.has = function(entity, components)
{
    const masks = this.arrays.map(a => 0)
    for (let i = 0; i < components.length; i++)
    {
        const { arrayIndex, mask } = this.components.get(components[i])
        masks[arrayIndex] |= mask
    }

    for (let j = 0; j < masks.length; j++)
    {
        const m = masks[j]
        if ((this.arrays[j][entity * this.sizeOfs[j]] & m) !== m)
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
    const { arrays, sizeOfs } = this;
    const array = arrays[0]
    const sizeOf = sizeOfs[0]

    return !!(array[entity * sizeOf] & 1)
}

/**
 * Removes the given entity from the system.
 *
 * @param entity    entity id
 */
EntitySystem.prototype.removeEntity = function removeEntity(entity)
{
    const { arrays, sizeOfs } = this;

    for (let i = 0; i < arrays.length; i++)
    {
        const array = arrays[i]
        const sizeOf = sizeOfs[i]
        array[entity * sizeOf] = 0
    }

    this.removeCounter++
}

/**
 * Adds the given component to the given entity.
 *
 * @param {number} entity                   entity id
 * @param {String|Array.<String>} name      component name or array of component names
 */
EntitySystem.prototype.addComponent = function addComponent(entity, name)
{
    const [arrayIndex,mask] = getSameTableMask(this, name, "addComponent")

    const before = this.arrays[arrayIndex][entity * this.sizeOfs[arrayIndex]];
    const newValue = before | mask
    this.arrays[arrayIndex][entity * this.sizeOfs[arrayIndex]] = newValue

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
    const [arrayIndex,mask] = getSameTableMask(this, name, "removeComponent")
    const before = this.arrays[arrayIndex][entity * this.sizeOfs[arrayIndex]]
    const newValue = before & ~mask
    this.arrays[arrayIndex][entity * this.sizeOfs[arrayIndex]] = newValue

    runExitHandlers(this.exitHandlers, entity, before, newValue)
}

/**
 * Adds the component implied by the property names within the given template to the entity and
 * adds all the components. You can also set properties of components the entity already has.
 *
 * @param {number} entity       entity id
 * @param template              template with new properties implying new components
 * @param {boolean} [exists]    if true, mark entity as existing (internal use)
 */
EntitySystem.prototype.addComponents = function addComponents(entity, template, exists = false)
{
    const masks = this.arrays.map((a,arrayIndex) => a[entity * this.sizeOfs[arrayIndex]])
    if (exists)
    {
        masks[0] |= 1
    }
    
    for (let name in template)
    {
        if (template.hasOwnProperty(name))
        {
            const { array, offset, sizeOf, componentMask } = this.getPropConfig(name)
            const v = template[name]
            this.arrays[array][entity * sizeOf + offset] = v

            masks[array] |= componentMask
        }
    }

    for (let j = 0; j < masks.length; j++)
    {
        const mask = masks[j]
        const before = this.arrays[j][entity * this.sizeOfs[j]];
        const newValue = before | mask
        this.arrays[j][entity * this.sizeOfs[j]] = newValue

        runEntryHandlers(this.entryHandlers, entity, before, newValue)
    }
}

/**
 * Entity system configuration from the view point of a single prop name
 *
 * @typedef PropConfig
 * @type {object}
 * @property {String} component         component name the prop belongs to
 * @property {number} array             array the prop is stored in
 * @property {number} offset            row offset of the prop
 * @property {number} sizeOf            size of the corresponding array rows
 * @property {number} componentMask     component mask of the corresponding component
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
    const { array, offset, sizeOf } = this.getPropConfig(name)
    return this.arrays[array][entity * sizeOf + offset];
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
    const { array, offset, sizeOf } = this.getPropConfig(name)
    this.arrays[array][entity * sizeOf + offset] = value;
}

EntitySystem.prototype.onEnter = function onEnter(mask, fn)
{
    this.entryHandlers.push(mask, fn)
    return () => {
        this.entryHandlers = removeHandler(this.entryHandlers, fn)
    }

}

EntitySystem.prototype.onExit = function onExit(mask, fn)
{
    this.exitHandlers.push(mask, fn)
    return () => {
        this.exitHandlers = removeHandler(this.exitHandlers, fn)
    }
}

module.exports = EntitySystem
