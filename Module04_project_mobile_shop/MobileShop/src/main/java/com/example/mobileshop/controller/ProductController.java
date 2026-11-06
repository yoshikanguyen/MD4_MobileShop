package com.example.mobileshop.controller;

import com.example.mobileshop.dto.ProductRequest;
import com.example.mobileshop.entity.Product;
import com.example.mobileshop.service.ProductService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;

@RestController
@RequestMapping("/api/products")
public class ProductController {
    private final ProductService service;

    public ProductController(ProductService service) {
        this.service = service;
    }

    @GetMapping
    public Page<Product> all(@RequestParam(defaultValue = "0") int page,
                             @RequestParam(defaultValue = "10") int size,
                             @RequestParam(required = false) String brand,
                             @RequestParam(required = false) BigDecimal minPrice,
                             @RequestParam(required = false) BigDecimal maxPrice,
                             @RequestParam(required = false) Integer minStock,
                             @RequestParam(defaultValue = "id") String sortBy,
                             @RequestParam(defaultValue = "asc") String direction) {
        if (page < 0 || size < 1 || size > 100)
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.BAD_REQUEST, "Phân trang không hợp lệ (size 1–100)");
        return service.search(brand, minPrice, maxPrice, minStock, page, size, sortBy, direction);
    }

    @GetMapping("/options")
    public List<Product> options() {
        return service.all();
    }

    @GetMapping("/{id}")
    public Product byId(@PathVariable Long id) {
        return service.byId(id);
    }

    @PostMapping
    public ResponseEntity<Product> create(@Valid @RequestBody ProductRequest r) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(r));
    }

    @PutMapping("/{id}")
    public Product update(@PathVariable Long id, @Valid @RequestBody ProductRequest r) {
        return service.update(id, r);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
