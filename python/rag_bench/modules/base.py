"""
Base Classes for RAG-Lab Modules

This module defines the abstract base classes that all RAG-Lab extensions must
implement. The module system is designed to be:

1. **Type-safe**: All modules have well-defined interfaces
2. **Discoverable**: Modules self-register and expose their configuration schemas
3. **Composable**: Multiple preprocessors and filters can be chained
4. **Configurable**: Modules expose configuration options to the frontend

Module Types:
    - QueryPreprocessor: Transforms queries before retrieval
    - RelevanceFilter: Filters or reranks documents after retrieval  
    - SearchType: Implements different retrieval strategies
    - DocumentProcessor: Transforms documents during database ingestion

Usage:
    ```python
    from rag_bench.modules import QueryPreprocessor, ModuleConfig

    class MyPreprocessor(QueryPreprocessor):
        '''Expands queries with domain-specific synonyms.'''
        
        MODULE_ID = "my-preprocessor"
        MODULE_NAME = "My Query Preprocessor"
        MODULE_DESCRIPTION = "Expands queries with custom synonyms"
        
        @classmethod
        def get_config_schema(cls) -> list[ModuleConfig]:
            return [
                ModuleConfig(
                    key="synonym_file",
                    type="string",
                    label="Synonym File Path",
                    description="Path to JSON file containing synonyms",
                    required=True,
                ),
            ]
        
        def __init__(self, config: dict):
            super().__init__(config)
            self.synonyms = self._load_synonyms(config.get("synonym_file", ""))
        
        def process(self, query: str, context: dict) -> tuple[str, dict]:
            enhanced = self._expand_query(query)
            return enhanced, {"original_query": query, "expansions": [...]}
    ```
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, Type


class ModuleType(str, Enum):
    """Types of modules supported by RAG-Lab."""
    
    PREPROCESSOR = "preprocessor"
    """Query preprocessors transform queries before retrieval."""
    
    FILTER = "filter"
    """Relevance filters rerank or filter documents after retrieval."""
    
    SEARCH_TYPE = "search_type"
    """Search types implement different retrieval strategies."""
    
    DOCUMENT_PROCESSOR = "document_processor"
    """Document processors transform documents during database ingestion."""


@dataclass
class ModuleConfig:
    """
    Configuration option exposed by a module.
    
    These are displayed in the frontend settings panel and allow users
    to customize module behavior without modifying code.
    
    Attributes:
        key: Unique identifier for this config option
        type: Data type ("string", "number", "boolean", "select", "multiselect")
        label: Human-readable label for the UI
        description: Detailed description/help text
        default: Default value if not specified
        required: Whether this option must be provided
        options: For "select"/"multiselect" types, the available choices
        min: For "number" type, minimum value
        max: For "number" type, maximum value
    """
    
    key: str
    type: str  # "string", "number", "boolean", "select", "multiselect"
    label: str
    description: str = ""
    default: Any = None
    required: bool = False
    options: Optional[List[Dict[str, Any]]] = None  # For select types: [{"value": ..., "label": ...}]
    min: Optional[float] = None  # For number type
    max: Optional[float] = None  # For number type


@dataclass
class ModuleManifest:
    """
    Complete manifest describing a module.
    
    This is serialized to JSON and sent to the frontend for module discovery.
    
    Attributes:
        id: Unique module identifier (e.g., "my-query-expander")
        name: Human-readable name
        description: Detailed description of what the module does
        type: The module type (preprocessor, filter, search_type)
        version: Semantic version string
        author: Module author/maintainer
        enabled_by_default: Whether this module is enabled by default
        config_schema: List of configuration options
        tags: Searchable tags for categorization
    """
    
    id: str
    name: str
    description: str
    type: ModuleType
    version: str = "1.0.0"
    author: str = ""
    enabled_by_default: bool = False
    config_schema: List[ModuleConfig] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert manifest to JSON-serializable dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "type": self.type.value,
            "version": self.version,
            "author": self.author,
            "enabledByDefault": self.enabled_by_default,
            "configSchema": [
                {
                    "key": c.key,
                    "type": c.type,
                    "label": c.label,
                    "description": c.description,
                    "default": c.default,
                    "required": c.required,
                    "options": c.options,
                    "min": c.min,
                    "max": c.max,
                }
                for c in self.config_schema
            ],
            "tags": self.tags,
        }


class BaseModule(ABC):
    """
    Abstract base class for all RAG-Lab modules.
    
    All module implementations must:
    1. Set the class-level MODULE_ID, MODULE_NAME, MODULE_DESCRIPTION
    2. Implement get_config_schema() to expose configuration options
    3. Accept a config dict in __init__
    
    Attributes:
        MODULE_ID: Unique identifier (lowercase, hyphens, e.g., "my-module")
        MODULE_NAME: Human-readable name
        MODULE_DESCRIPTION: Detailed description
        MODULE_VERSION: Semantic version string
        MODULE_AUTHOR: Author/maintainer name
        MODULE_TAGS: List of searchable tags
        ENABLED_BY_DEFAULT: Whether enabled when first discovered
    """
    
    MODULE_ID: str = ""
    MODULE_NAME: str = ""
    MODULE_DESCRIPTION: str = ""
    MODULE_VERSION: str = "1.0.0"
    MODULE_AUTHOR: str = ""
    MODULE_TAGS: List[str] = []
    ENABLED_BY_DEFAULT: bool = False
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize the module with configuration.
        
        Args:
            config: Dictionary of configuration values matching the schema
        """
        self.config = config
        self._validate_config()
    
    def _validate_config(self) -> None:
        """Validate that all required config options are present."""
        schema = self.get_config_schema()
        for opt in schema:
            if opt.required and opt.key not in self.config:
                raise ValueError(
                    f"Module {self.MODULE_ID}: Missing required config '{opt.key}'"
                )
    
    @classmethod
    @abstractmethod
    def get_module_type(cls) -> ModuleType:
        """Return the type of this module."""
        pass
    
    @classmethod
    def get_config_schema(cls) -> List[ModuleConfig]:
        """
        Return the configuration schema for this module.
        
        Override this method to expose configuration options to the frontend.
        
        Returns:
            List of ModuleConfig objects describing available options
        """
        return []
    
    @classmethod
    def get_manifest(cls) -> ModuleManifest:
        """Generate the complete module manifest."""
        return ModuleManifest(
            id=cls.MODULE_ID,
            name=cls.MODULE_NAME,
            description=cls.MODULE_DESCRIPTION,
            type=cls.get_module_type(),
            version=cls.MODULE_VERSION,
            author=cls.MODULE_AUTHOR,
            enabled_by_default=cls.ENABLED_BY_DEFAULT,
            config_schema=cls.get_config_schema(),
            tags=cls.MODULE_TAGS,
        )


class QueryPreprocessor(BaseModule):
    """
    Base class for query preprocessors.
    
    Query preprocessors transform the user's query before it is sent to the
    retrieval system. Common use cases include:
    
    - Query expansion (adding synonyms or related terms)
    - Domain-specific term mapping
    - Query normalization
    - Intent detection and query reformulation
    
    Preprocessors can be chained - each preprocessor receives the output
    of the previous one.
    
    Example:
        ```python
        class SynonymExpander(QueryPreprocessor):
            MODULE_ID = "synonym-expander"
            MODULE_NAME = "Synonym Expander"
            
            def process(self, query: str, context: dict) -> tuple[str, dict]:
                expanded = self._expand_synonyms(query)
                return expanded, {"expansions": self.found_synonyms}
        ```
    """
    
    @classmethod
    def get_module_type(cls) -> ModuleType:
        return ModuleType.PREPROCESSOR
    
    @abstractmethod
    def process(self, query: str, context: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """
        Process and transform the query.
        
        Args:
            query: The input query string (may be already modified by prior preprocessors)
            context: Contextual information that can be used/modified:
                - "original_query": The original unmodified query
                - "metadata": Any metadata from the request
                - Custom keys added by prior preprocessors
        
        Returns:
            Tuple of (transformed_query, updated_context)
            - transformed_query: The modified query string
            - updated_context: The context dict with any additions
        """
        pass


class RelevanceFilter(BaseModule):
    """
    Base class for document relevance filters.
    
    Relevance filters process the retrieved documents after the initial
    retrieval. They can:
    
    - Filter out irrelevant documents
    - Rerank documents based on custom criteria
    - Add relevance scores or annotations
    - Merge/deduplicate similar documents
    
    Filters can be chained - each filter receives the output of the previous one.
    
    Example:
        ```python
        class KeywordBooster(RelevanceFilter):
            MODULE_ID = "keyword-booster"
            MODULE_NAME = "Keyword Booster"
            
            def filter(
                self,
                query: str,
                documents: list[dict],
                context: dict
            ) -> tuple[list[dict], dict]:
                # Boost documents containing important keywords
                scored = [(doc, self._score(doc, query)) for doc in documents]
                sorted_docs = sorted(scored, key=lambda x: x[1], reverse=True)
                return [d for d, _ in sorted_docs], {"filter_applied": True}
        ```
    """
    
    @classmethod
    def get_module_type(cls) -> ModuleType:
        return ModuleType.FILTER
    
    @abstractmethod
    def filter(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        context: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Filter and/or rerank the retrieved documents.
        
        Args:
            query: The query that was used for retrieval
            documents: List of retrieved documents, each with:
                - "content": The document text
                - "metadata": Document metadata (source, page, etc.)
                - "score": Retrieval score (if available)
            context: Contextual information from preprocessing
        
        Returns:
            Tuple of (filtered_documents, updated_context)
            - filtered_documents: The processed document list
            - updated_context: The context dict with any additions
        """
        pass


class SearchType(BaseModule):
    """
    Base class for search type implementations.
    
    Search types define how documents are retrieved from the vector store.
    Built-in search types include:
    
    - Vector: Dense embedding similarity search
    - BM25: Sparse lexical search
    - Hybrid: Combination of vector and lexical search
    
    Custom search types can implement specialized retrieval strategies
    for specific domains or use cases.
    
    Example:
        ```python
        class SemanticChunkSearch(SearchType):
            MODULE_ID = "semantic-chunk"
            MODULE_NAME = "Semantic Chunk Search"
            
            def search(
                self,
                query: str,
                db,
                k: int,
                context: dict
            ) -> tuple[list[dict], dict]:
                # Custom retrieval logic
                chunks = self._find_semantic_chunks(query, db, k)
                return chunks, {"search_type": "semantic_chunk"}
        ```
    
    Note: SearchType implementations have access to the vector store directly
    and can implement arbitrary retrieval strategies.
    """
    
    # For search types, we also track subtypes/variants
    SEARCH_VARIANTS: List[Dict[str, str]] = []  # [{"id": "variant-id", "name": "Variant Name"}]
    
    @classmethod
    def get_module_type(cls) -> ModuleType:
        return ModuleType.SEARCH_TYPE
    
    @classmethod
    def get_variants(cls) -> List[Dict[str, str]]:
        """
        Return available variants/subtypes for this search type.
        
        For example, BM25 might have variants: ["bm25", "bm25_no_idf", "tf"]
        
        Returns:
            List of variant descriptors with "id" and "name" keys
        """
        return cls.SEARCH_VARIANTS
    
    @abstractmethod
    def search(
        self,
        query: str,
        db: Any,
        k: int,
        context: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Perform the search and return documents.
        
        Args:
            query: The search query (potentially preprocessed)
            db: The vector store / database instance
            k: Number of documents to retrieve
            context: Contextual information including:
                - "variant": Which variant to use (if applicable)
                - "where": Filter conditions
                - Other context from preprocessing
        
        Returns:
            Tuple of (documents, updated_context)
            - documents: List of retrieved documents with content, metadata, score
            - updated_context: The context dict with search metadata
        """
        pass


class DocumentProcessor(BaseModule):
    """
    Base class for document processors.
    
    Document processors transform documents during the database ingestion phase.
    They run when building a vector database and can:
    
    - Extract custom metadata from filenames or content
    - Transform document text before chunking
    - Add domain-specific annotations
    - Filter out irrelevant documents
    
    Processors can be chained - each processor receives the output of the previous one.
    
    Example:
        ```python
        class MetadataExtractor(DocumentProcessor):
            MODULE_ID = "metadata-extractor"
            MODULE_NAME = "Metadata Extractor"
            
            def process_document(
                self,
                content: str,
                metadata: dict,
                context: dict
            ) -> tuple[str, dict, dict]:
                # Extract custom metadata from filename
                filename = metadata.get("doc_name", "")
                extracted = self._parse_filename(filename)
                metadata.update(extracted)
                return content, metadata, context
        ```
    
    Note: Document processors run at ingestion time, not query time.
    Enable them before building your database.
    """
    
    @classmethod
    def get_module_type(cls) -> ModuleType:
        return ModuleType.DOCUMENT_PROCESSOR
    
    @abstractmethod
    def process_document(
        self,
        content: str,
        metadata: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Tuple[str, Dict[str, Any], Dict[str, Any]]:
        """
        Process a document during ingestion.
        
        Args:
            content: The document text content
            metadata: Document metadata dict, typically containing:
                - "source": Original file path
                - "doc_name": Filename
                - "doc_id": Document identifier
                - "page": Page number (for PDFs)
                - "type": Document type
            context: Contextual information that can be used/modified:
                - "config": Build configuration
                - Custom keys added by prior processors
        
        Returns:
            Tuple of (processed_content, updated_metadata, updated_context)
            - processed_content: The (possibly modified) document text
            - updated_metadata: The metadata dict with any additions
            - updated_context: The context dict with any additions
            
        Note:
            Return None for content to skip/filter out this document.
        """
        pass
    
    def process_documents(
        self,
        documents: List[Tuple[str, Dict[str, Any]]],
        context: Dict[str, Any],
    ) -> Tuple[List[Tuple[str, Dict[str, Any]]], Dict[str, Any]]:
        """
        Process multiple documents. Override for batch operations.
        
        By default, this calls process_document for each document.
        Override this method if you need to do batch processing
        (e.g., for deduplication across documents).
        
        Args:
            documents: List of (content, metadata) tuples
            context: Contextual information
        
        Returns:
            Tuple of (processed_documents, updated_context)
        """
        processed = []
        for content, metadata in documents:
            result = self.process_document(content, metadata, context)
            if result[0] is not None:  # Skip if content is None
                processed.append((result[0], result[1]))
                context = result[2]
        return processed, context


# Type aliases for convenience
PreprocessorType = Type[QueryPreprocessor]
FilterType = Type[RelevanceFilter]
SearchTypeType = Type[SearchType]
DocumentProcessorType = Type[DocumentProcessor]
