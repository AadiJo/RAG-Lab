"""
Module Registry

The registry is responsible for:
1. Discovering modules from the modules/ directory
2. Managing module lifecycle (instantiation, configuration)
3. Providing module metadata to the frontend
4. Executing module pipelines (chains of preprocessors/filters)

Usage:
    ```python
    from rag_bench.modules import get_registry
    
    registry = get_registry()
    
    # List all available modules
    manifests = registry.list_modules()
    
    # Get enabled preprocessors
    preprocessors = registry.get_enabled_preprocessors(config)
    
    # Run the preprocessing pipeline
    enhanced_query, context = registry.run_preprocessors(query, config)
    ```
"""

import importlib
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Type

from .base import (
    BaseModule,
    DocumentProcessor,
    ImageFilter,
    ModuleManifest,
    ModuleType,
    QueryPreprocessor,
    RelevanceFilter,
    SearchType,
)

# Global registry instance
_registry: Optional["ModuleRegistry"] = None


def get_registry() -> "ModuleRegistry":
    """
    Get the global module registry instance.
    
    The registry is lazily initialized on first access and automatically
    discovers modules from the modules/ directory.
    
    Returns:
        The global ModuleRegistry instance
    """
    global _registry
    if _registry is None:
        _registry = ModuleRegistry()
        _registry.discover_modules()
    return _registry


class ModuleRegistry:
    """
    Central registry for all RAG-Lab modules.
    
    The registry maintains a catalog of all discovered modules and provides
    methods for:
    - Module discovery and registration
    - Module instantiation with configuration
    - Pipeline execution (chaining preprocessors/filters)
    - Module metadata export for the frontend
    
    Attributes:
        preprocessors: Dict mapping module ID to preprocessor class
        filters: Dict mapping module ID to filter class
        search_types: Dict mapping module ID to search type class
        document_processors: Dict mapping module ID to document processor class
        modules_dir: Path to the modules directory
    """
    
    def __init__(self, modules_dir: Optional[str] = None):
        """
        Initialize the registry.
        
        Args:
            modules_dir: Path to the modules directory. Defaults to
                         <project_root>/modules/
        """
        self.preprocessors: Dict[str, Type[QueryPreprocessor]] = {}
        self.filters: Dict[str, Type[RelevanceFilter]] = {}
        self.search_types: Dict[str, Type[SearchType]] = {}
        self.document_processors: Dict[str, Type[DocumentProcessor]] = {}
        self.image_filters: Dict[str, Type[ImageFilter]] = {}
        
        # Unified module lookup
        self._modules: Dict[str, Type[BaseModule]] = {}
        
        # Find modules directory
        if modules_dir:
            self.modules_dir = Path(modules_dir)
        else:
            # Default: <project_root>/modules/
            # Project root is determined relative to this file
            project_root = Path(__file__).parent.parent.parent.parent
            self.modules_dir = project_root / "modules"
        
        self._discovered = False
        self._builtin_registered = False
    
    def _register_builtins(self) -> None:
        """Register built-in search types."""
        if self._builtin_registered:
            return
        self._builtin_registered = True
        
        try:
            from rag_bench.search import VectorSearch, BM25Search, HybridSearch
            self.register_search_type(VectorSearch)
            self.register_search_type(BM25Search)
            self.register_search_type(HybridSearch)
        except ImportError:
            pass
    
    def register_preprocessor(self, cls: Type[QueryPreprocessor]) -> None:
        """
        Register a query preprocessor class.
        
        Args:
            cls: The preprocessor class to register
        """
        if not cls.MODULE_ID:
            raise ValueError(f"Preprocessor {cls.__name__} has no MODULE_ID")
        self.preprocessors[cls.MODULE_ID] = cls
        self._modules[cls.MODULE_ID] = cls
    
    def register_filter(self, cls: Type[RelevanceFilter]) -> None:
        """
        Register a relevance filter class.
        
        Args:
            cls: The filter class to register
        """
        if not cls.MODULE_ID:
            raise ValueError(f"Filter {cls.__name__} has no MODULE_ID")
        self.filters[cls.MODULE_ID] = cls
        self._modules[cls.MODULE_ID] = cls
    
    def register_search_type(self, cls: Type[SearchType]) -> None:
        """
        Register a search type class.
        
        Args:
            cls: The search type class to register
        """
        if not cls.MODULE_ID:
            raise ValueError(f"SearchType {cls.__name__} has no MODULE_ID")
        self.search_types[cls.MODULE_ID] = cls
        self._modules[cls.MODULE_ID] = cls
    
    def register_document_processor(self, cls: Type[DocumentProcessor]) -> None:
        """
        Register a document processor class.
        
        Args:
            cls: The document processor class to register
        """
        if not cls.MODULE_ID:
            raise ValueError(f"DocumentProcessor {cls.__name__} has no MODULE_ID")
        self.document_processors[cls.MODULE_ID] = cls
        self._modules[cls.MODULE_ID] = cls
    
    def register_image_filter(self, cls: Type[ImageFilter]) -> None:
        """
        Register an image filter class.
        
        Args:
            cls: The image filter class to register
        """
        if not cls.MODULE_ID:
            raise ValueError(f"ImageFilter {cls.__name__} has no MODULE_ID")
        self.image_filters[cls.MODULE_ID] = cls
        self._modules[cls.MODULE_ID] = cls
    
    def register(self, cls: Type[BaseModule]) -> None:
        """
        Register a module class (auto-detects type).
        
        Args:
            cls: The module class to register
        """
        module_type = cls.get_module_type()
        if module_type == ModuleType.PREPROCESSOR:
            self.register_preprocessor(cls)  # type: ignore
        elif module_type == ModuleType.FILTER:
            self.register_filter(cls)  # type: ignore
        elif module_type == ModuleType.SEARCH_TYPE:
            self.register_search_type(cls)  # type: ignore
        elif module_type == ModuleType.DOCUMENT_PROCESSOR:
            self.register_document_processor(cls)  # type: ignore
        elif module_type == ModuleType.IMAGE_FILTER:
            self.register_image_filter(cls)  # type: ignore
        else:
            raise ValueError(f"Unknown module type: {module_type}")
    
    def get_module(self, module_id: str) -> Optional[Type[BaseModule]]:
        """
        Get a module class by ID.
        
        Args:
            module_id: The module ID to look up
        
        Returns:
            The module class or None if not found
        """
        return self._modules.get(module_id)
    
    def discover_modules(self) -> None:
        """
        Discover and load all modules from the modules directory.
        
        This method scans the modules directory for Python packages that
        contain a register() function and calls it with this registry.
        
        Module packages should have this structure:
            modules/
                my_module/
                    __init__.py  # Must have: def register(registry): ...
                    ...
        """
        if self._discovered:
            return
        
        self._discovered = True
        
        # Register built-in search types first
        self._register_builtins()
        
        if not self.modules_dir.exists():
            return
        
        # Add modules dir to path for imports
        modules_parent = str(self.modules_dir.parent)
        if modules_parent not in sys.path:
            sys.path.insert(0, modules_parent)
        
        # Scan for module packages
        for item in self.modules_dir.iterdir():
            if not item.is_dir():
                continue
            if item.name.startswith("_") or item.name.startswith("."):
                continue
            
            init_file = item / "__init__.py"
            if not init_file.exists():
                continue
            
            try:
                # Import the module package
                module_name = f"modules.{item.name}"
                spec = importlib.util.spec_from_file_location(module_name, init_file)
                if spec is None or spec.loader is None:
                    continue
                
                module = importlib.util.module_from_spec(spec)
                sys.modules[module_name] = module
                spec.loader.exec_module(module)
                
                # Call register() if it exists
                if hasattr(module, "register"):
                    module.register(self)
                    
            except Exception as e:
                print(f"Warning: Failed to load module '{item.name}': {e}")
    
    def list_modules(self) -> List[Dict[str, Any]]:
        """
        List all registered modules with their manifests.
        
        Returns:
            List of module manifests as dictionaries
        """
        modules = []
        
        for cls in self.preprocessors.values():
            modules.append(cls.get_manifest().to_dict())
        
        for cls in self.filters.values():
            modules.append(cls.get_manifest().to_dict())
        
        for cls in self.search_types.values():
            manifest = cls.get_manifest().to_dict()
            manifest["variants"] = cls.get_variants()
            modules.append(manifest)
        
        for cls in self.document_processors.values():
            modules.append(cls.get_manifest().to_dict())
        
        for cls in self.image_filters.values():
            modules.append(cls.get_manifest().to_dict())
        
        return modules
    
    def list_document_processors(self) -> List[Dict[str, Any]]:
        """
        List all registered document processors.
        
        Returns:
            List of document processor manifests
        """
        return [cls.get_manifest().to_dict() for cls in self.document_processors.values()]
    
    def list_image_filters(self) -> List[Dict[str, Any]]:
        """
        List all registered image filters.
        
        Returns:
            List of image filter manifests
        """
        return [cls.get_manifest().to_dict() for cls in self.image_filters.values()]
    
    def get_enabled_image_filters(
        self,
        module_config: Dict[str, Dict[str, Any]],
    ) -> List[ImageFilter]:
        """
        Get instantiated image filters based on configuration.
        
        Args:
            module_config: Dict mapping module IDs to their config
        
        Returns:
            List of instantiated image filter objects
        """
        instances = []
        
        for module_id, cls in self.image_filters.items():
            cfg = module_config.get(module_id, {})
            enabled = cfg.get("enabled", cls.ENABLED_BY_DEFAULT)
            if not enabled:
                continue
            
            instance_config = cfg.get("config", {})
            try:
                instance = cls(instance_config)
                instances.append(instance)
            except Exception as e:
                print(f"Warning: Failed to instantiate image filter '{module_id}': {e}")
        
        return instances
    
    def get_enabled_document_processors(
        self,
        module_config: Dict[str, Dict[str, Any]],
    ) -> List[DocumentProcessor]:
        """
        Get instantiated document processors based on configuration.
        
        Args:
            module_config: Dict mapping module IDs to their config
        
        Returns:
            List of instantiated document processor objects
        """
        instances = []
        
        for module_id, cls in self.document_processors.items():
            cfg = module_config.get(module_id, {})
            enabled = cfg.get("enabled", cls.ENABLED_BY_DEFAULT)
            if not enabled:
                continue
            
            instance_config = cfg.get("config", {})
            try:
                instance = cls(instance_config)
                instances.append(instance)
            except Exception as e:
                print(f"Warning: Failed to instantiate document processor '{module_id}': {e}")
        
        return instances
    
    def list_search_types(self) -> List[Dict[str, Any]]:
        """
        List all registered search types with their variants.
        
        Returns:
            List of search type descriptors for the frontend dropdown
        """
        search_types = []
        
        for cls in self.search_types.values():
            search_types.append({
                "id": cls.MODULE_ID,
                "name": cls.MODULE_NAME,
                "description": cls.MODULE_DESCRIPTION,
                "variants": cls.get_variants(),
            })
        
        return search_types
    
    def get_enabled_preprocessors(
        self,
        module_config: Dict[str, Dict[str, Any]],
    ) -> List[QueryPreprocessor]:
        """
        Get instantiated preprocessors based on configuration.
        
        Args:
            module_config: Dict mapping module IDs to their config:
                {
                    "module-id": {
                        "enabled": True,
                        "config": {"key": "value", ...}
                    },
                    ...
                }
        
        Returns:
            List of instantiated preprocessor objects
        """
        instances = []
        
        for module_id, cls in self.preprocessors.items():
            cfg = module_config.get(module_id, {})
            
            # Check if enabled (default to module's ENABLED_BY_DEFAULT)
            enabled = cfg.get("enabled", cls.ENABLED_BY_DEFAULT)
            if not enabled:
                continue
            
            # Instantiate with config
            instance_config = cfg.get("config", {})
            try:
                instance = cls(instance_config)
                instances.append(instance)
            except Exception as e:
                print(f"Warning: Failed to instantiate preprocessor '{module_id}': {e}")
        
        return instances
    
    def get_enabled_filters(
        self,
        module_config: Dict[str, Dict[str, Any]],
    ) -> List[RelevanceFilter]:
        """
        Get instantiated filters based on configuration.
        
        Args:
            module_config: Dict mapping module IDs to their config
        
        Returns:
            List of instantiated filter objects
        """
        instances = []
        
        for module_id, cls in self.filters.items():
            cfg = module_config.get(module_id, {})
            enabled = cfg.get("enabled", cls.ENABLED_BY_DEFAULT)
            if not enabled:
                continue
            
            instance_config = cfg.get("config", {})
            try:
                instance = cls(instance_config)
                instances.append(instance)
            except Exception as e:
                print(f"Warning: Failed to instantiate filter '{module_id}': {e}")
        
        return instances
    
    def get_search_type(
        self,
        search_type_id: str,
        config: Dict[str, Any],
    ) -> Optional[SearchType]:
        """
        Get an instantiated search type.
        
        Args:
            search_type_id: The search type module ID
            config: Configuration for the search type
        
        Returns:
            Instantiated search type or None if not found
        """
        cls = self.search_types.get(search_type_id)
        if cls is None:
            return None
        
        try:
            return cls(config)
        except Exception as e:
            print(f"Warning: Failed to instantiate search type '{search_type_id}': {e}")
            return None
    
    def run_preprocessors(
        self,
        query: str,
        module_config: Dict[str, Dict[str, Any]],
        initial_context: Optional[Dict[str, Any]] = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """
        Run the preprocessing pipeline.
        
        Chains all enabled preprocessors, passing the output of each
        to the next.
        
        Args:
            query: The original query string
            module_config: Module configuration dict
            initial_context: Optional initial context
        
        Returns:
            Tuple of (processed_query, final_context)
        """
        context = initial_context or {}
        context["original_query"] = query
        current_query = query
        
        preprocessors = self.get_enabled_preprocessors(module_config)
        
        for preprocessor in preprocessors:
            try:
                current_query, context = preprocessor.process(current_query, context)
            except Exception as e:
                print(f"Warning: Preprocessor '{preprocessor.MODULE_ID}' failed: {e}")
        
        return current_query, context
    
    def run_filters(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        module_config: Dict[str, Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Run the post-processing filter pipeline.
        
        Chains all enabled filters, passing the output of each to the next.
        
        Args:
            query: The query that was used for retrieval
            documents: The retrieved documents
            module_config: Module configuration dict
            context: Context from preprocessing
        
        Returns:
            Tuple of (filtered_documents, final_context)
        """
        ctx = context or {}
        current_docs = documents
        
        filters = self.get_enabled_filters(module_config)
        
        for filt in filters:
            try:
                current_docs, ctx = filt.filter(query, current_docs, ctx)
            except Exception as e:
                print(f"Warning: Filter '{filt.MODULE_ID}' failed: {e}")
        
        return current_docs, ctx
