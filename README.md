# @fforw/entity 

The @fforw/entity package implements an experimental entity component system for JavaScript.
It stores its entities and components in typed arrays for quick access. 

## Entity Macro

The entity system comes with a babel macro that provides access to the typed arrays in
a user-friendly manner. The already quick access to the typed-array can be made slighly
faster by moving most of the access logic into compile time

### Example

```javascript
    import EntitySystem from "@fforw/entity"
    import $entity from "@fforw/entity/entity.macro"

    // ...

    $entity(a => {
        a.y = 10
        a.health--
    })

```

Also the variable *a* only contains a numerical entity id, the macro can provide normal 
member access to the component props of the entity. 
                                                  
#### Technical details

The macro will transform the above to the code below. The newly introduced *_a_T0_* contains
the row offset of the entity *a* within table *_array* (table 0)
```javascript
// ...
let _a_T0_ = entitySystem.e[a * 2 + 1],
    _array = entitySystem.c0;
_array[_a_T0_ + 2] = 10;
_array[_a_T0_ + 4]--;
```

### Macro Config

The macro does not need to be configured and will work with the default config name.
You need to enable the "babel-plugin-macros" plugin in your babel configuration.

The macro can be configured by two configuration options in the .babelrc ( or any
other config location suported by the cosmicconfig used by babel macros e.g. *.babel-plugin-macrosrc.json*)


```json
{
    "presets": [
        "@babel/preset-react",
        "@babel/preset-env"
    ],
    "plugins": [
        [
            "macros",
            {
                "entityMacro": {
                    "config": "test/test-macro-config.json",
                    "debug": false
                }
            }
        ]
    ]
}
```
 
The *config* option can be used to configure an alternate config location. The *debug* 
option will make the macro 
             
## Configuration

The entity system is defined by a static JSON configuration that defines all possible components
and how to lay out the memory tables for them.

### Example
```json
{
    "Components" : {
        "Appearance" : [ "x", "y", "z"],
        "Health" : [ "health" ],
        "Marked" : []
    },

    "Layout" : [
        {
            "components": ["Appearance", "Health", "Marked"],
            "size" : 1024
        }
    ],
    
    "entityCount" : 1024
}
```

The *Components* map defines the components of the system and the unique props for
each component. 

The *Layout* array defines the memory layout of the components. Each entry defines a
table shared by the configured components. The size defines the initial array size in 
rows. The array will grow if that size is overstepped. In general it is recommended to
configure your system to sizes that never or only rarely require growing.

The *entityCount* setting defines the initial number of entity slots. It too will grow 
and the same caveats apply.
                                              
*"Marked"* is a tag component that has no props associated with it. It needs to be 
added to a table nevertheless. 

# API

The API revolves around the EntitySystem class which is created with the JSON
configuration
```javascript
import EntitySystem from "@fforw/entity"
import config from "../../entity-config.json"
const entitySystem = new EntitySystem(config)
``` 

## newEntity()
                                       
Creates a new entity, optionally from a template object.

```javascript
// just the entity
const entity = entitySystem.newEntity()

// .. or from a convenient template
const another = entitySystem.newEntity({
    x: 0,
    y: 0,
    z: 100,
    health: 100
})
``` 
                                                        
The properties of the optional template object must match a component definition. The components
corresponding to the given props will be automatically added.


## forEach(tableIndex, mask, callback)

Allows iteration over entities matching the given table index and mask

```javascript
const mask = entitySystem.mask(["Appearance", "Health"])
    
    // ...

const entity = entitySystem.forEach(0, mask, entity => {
    // ...
})
``` 

## has(entity, components)

Returns true if the given entity has the given components. Components can give given
as component names (from any table) or as an array of numeric mask values, one for each table.


## exists(entity)

Returns true if the given entity exists currently. Note that entity ids are recycled,
so if you need permanent ids, you need to make that happen yourself. The entity id is 
only constant and unique over the lifetime of the entity.

## removeEntity(entity)

Removes the given entity from the system.


## addComponent(entity, component)

Adds the given component to the given entity. 


## removeComponent(entity, component)

Removes the given component from the given entity.


## addComponents(entity, template)
           
Adds the implied components to given entity and sets the properties of the given template as 
component props for that entity. 

## getValue(entity, name) / setValue(entity, name, value)

A pair of methods to read or write a single component value without using the macro.
Note that using the macro will be slightly faster as it moves things to compile time and
inlines the access. It also is cheaper on repeated accesses.
                                                            

## onEnter(mask, callback)

Defines a callback function to be called whenever an entity enters the combination of
components expressed by the mask. It is only triggered when an entity did not have
all the components and then gains all of them (including creation).
                                                            

## onExit(mask, callback)

Defines a callback function to be called whenever an entity exits the combination of
components expressed by the mask. It is only triggered when a component had all the components
given and then loses one of them.


## mask(components)

Returns a bitmask for the given component names. The bitmask functionality requires
that the components given are all stored in the same table. This is the general
rule for all mask accepting methods.

```javascript
const mask = entitySystem.mask(["Appearance", "Health"])
``` 
The masks are needed for some functions are meant to be reused.


## getArrayIndex(component)

Returns the property name that contains the table for the given component.

```javascript
const property = entitySystem.getTableName("Appearance")
const array = entitySystem[property]
``` 

                                   



