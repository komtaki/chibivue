import { proxyRefs } from "../reactivity";
import { ReactiveEffect } from "../reactivity/effect";
import { EffectScope } from "../reactivity/effectScope";
import { isFunction, isObject } from "../shared";
import { AppContext, createAppContext } from "./apiCreateApp";
import { EmitsOptions, ObjectEmitsOptions, emit } from "./componentEmits";
import { ComponentOptions, applyOptions } from "./componentOptions";
import { NormalizedProps, initProps } from "./componentProps";
import {
  ComponentPublicInstance,
  PublicInstanceProxyHandlers,
} from "./componentPublicInstance";
import { LifecycleHooks } from "./enums";
import { VNode, VNodeChild } from "./vnode";

export type Data = Record<string, unknown>;

export type Component = ConcreteComponent;
export type ConcreteComponent = ComponentOptions;

type LifecycleHook<TFn = Function> = TFn[] | null;

export interface ComponentInternalInstance {
  type: ConcreteComponent;
  appContext: AppContext;

  /**
   * Vnode representing this component in its parent's vdom tree
   */
  vnode: VNode;
  next: VNode | null;

  proxy: ComponentPublicInstance | null;
  effect: ReactiveEffect;
  scope: EffectScope;

  /**
   * Resolved component registry, only for components with mixins or extends
   * @internal
   */
  components: Record<string, ConcreteComponent> | null;

  /**
   * resolved props options
   * @internal
   */
  propsOptions: NormalizedProps;
  /**
   * resolved emits options
   * @internal
   */
  emitsOptions: ObjectEmitsOptions | null;

  /**
   * Root vnode of this component's own vdom tree
   */
  subTree: VNode;

  // TODO:
  // directives: Record<string, Directive> | null

  render: InternalRenderFunction | null;
  update: () => void;

  /**
   * Object containing values this component provides for its descendents
   * @internal
   */
  provides: Data;

  /**
   * This is the target for the public instance proxy. It also holds properties
   * injected by user options (computed, methods etc.) and user-attached
   * custom properties (via `this.x = ...`)
   * @internal
   */
  ctx: Data;

  // state
  data: Data;
  props: Data;
  emit: EmitFn;

  /**
   * setup related
   * @internal
   */
  setupState: Data;
  setupContext: SetupContext | null;

  // lifecycle
  isMounted: boolean;
  [LifecycleHooks.MOUNTED]: LifecycleHook;
}

// TODO: type as generic
export type EmitFn = (event: string, ...args: any[]) => void;

// TODO: type as generic
export type SetupContext = { emit: EmitFn };

export type InternalRenderFunction = {
  (
    ctx: ComponentPublicInstance,
    $data: ComponentInternalInstance["data"],
    $options: ComponentInternalInstance["ctx"]
  ): VNodeChild;
  _rc?: boolean; // isRuntimeCompiled

  // __COMPAT__ only
  _compatChecked?: boolean; // v3 and already checked for v2 compat
  _compatWrapped?: boolean; // is wrapped for v2 compat
};

export function createComponentInstance(
  vnode: VNode,
  parent: ComponentInternalInstance | null
): ComponentInternalInstance {
  const type = vnode.type as ConcreteComponent;
  const appContext =
    (parent ? parent.appContext : vnode.appContext) || createAppContext();

  const instance: ComponentInternalInstance = {
    type,
    vnode,
    appContext,
    next: null,
    proxy: null,
    effect: null!,
    scope: new EffectScope(),
    subTree: null!,
    update: null!,
    render: null!,

    provides: parent ? parent.provides : Object.create(appContext.provides),
    components: null,
    propsOptions: type.props || {},
    emitsOptions: type.emits || {},
    emit: null!, // to be set immediately

    ctx: {},
    data: {},
    props: {},

    setupState: {},
    setupContext: null,
    isMounted: false,
    m: null,
  };

  instance.ctx = { _: instance };
  instance.emit = emit.bind(null, instance);

  return instance;
}

export let currentInstance: ComponentInternalInstance | null = null;
export const getCurrentInstance: () => ComponentInternalInstance | null = () =>
  currentInstance;

export const setCurrentInstance = (instance: ComponentInternalInstance) => {
  currentInstance = instance;
  instance.scope.on();
};

export const unsetCurrentInstance = () => {
  currentInstance && currentInstance.scope.off();
  currentInstance = null;
};

export const setupComponent = (instance: ComponentInternalInstance) => {
  const { props } = instance.vnode;
  initProps(instance, props);

  const Component = instance.type as ComponentOptions;

  instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers);

  // Composition API
  const { setup } = Component;
  if (setup) {
    const setupContext = (instance.setupContext = createSetupContext(instance));
    setCurrentInstance(instance);
    const setupResult = setup(instance.props, setupContext);
    if (isFunction(setupResult)) {
      instance.render = setupResult as InternalRenderFunction;
    } else if (isObject(setupResult)) {
      instance.setupState = proxyRefs(setupResult);
    }
    unsetCurrentInstance();
  }

  if (compile && !Component.render) {
    const template = Component.template ?? "";
    if (template) {
      instance.render = compile(template);
    }
  }

  // Options API
  setCurrentInstance(instance);
  applyOptions(instance);
  unsetCurrentInstance();
};

type CompileFunction = (template: string | object) => InternalRenderFunction;
let compile: CompileFunction | undefined;

/**
 * For runtime-dom to register the compiler.
 * Note the exported method uses any to avoid d.ts relying on the compiler types.
 */
export function registerRuntimeCompiler(_compile: any) {
  compile = _compile;
}

export function createSetupContext(
  instance: ComponentInternalInstance
): SetupContext {
  return { emit: instance.emit };
}
